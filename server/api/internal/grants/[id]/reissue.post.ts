import { and, eq, inArray } from "drizzle-orm";

import db from "../../../../db";
import { projectGrantTable, shipTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { roundUpHardwareGrantCents } from "../../../../lib/grants";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid grant ID" });
  }

  const reason = (await readBody<{ reason?: string | null }>(event))?.reason?.trim() || null;

  const [source] = await db
    .select()
    .from(projectGrantTable)
    .where(eq(projectGrantTable.id, id))
    .limit(1);

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: "Grant not found" });
  }
  if (source.status !== "cancelled") {
    throw createError({
      statusCode: 409,
      statusMessage: `Grant is ${source.status}; only cancelled grants can be reissued.`,
    });
  }

  // The partial unique index would block the insert anyway; a clean 409 is friendlier than a DB error.
  const [conflict] = await db
    .select({ id: projectGrantTable.id })
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.ship_id, source.ship_id),
        inArray(projectGrantTable.status, ["queued", "sent"]),
      ),
    )
    .limit(1);
  if (conflict) {
    throw createError({
      statusCode: 409,
      statusMessage: "An active grant already exists for this ship.",
    });
  }

  // Re-read the ship so a corrected amount is picked up.
  const [ship] = await db
    .select({
      needs_funding_amount_cents: shipTable.needs_funding_amount_cents,
    })
    .from(shipTable)
    .where(eq(shipTable.id, source.ship_id))
    .limit(1);

  // Rounding also corrects historical rows that pre-date the $10 rule.
  const amountCents = roundUpHardwareGrantCents(
    ship?.needs_funding_amount_cents != null
      ? ship.needs_funding_amount_cents
      : source.amount_cents,
  );

  if (amountCents <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Ship has no valid grant amount to reissue.",
    });
  }

  const [newGrant] = await db
    .insert(projectGrantTable)
    .values({
      project_id: source.project_id,
      ship_id: source.ship_id,
      user_id: source.user_id,
      amount_cents: amountCents,
      status: "queued",
      reissued_from_id: source.id,
    })
    .returning();

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "reissue_project_grant",
      entity_type: "project_grant",
      entity_id: String(newGrant.id),
      old_value: source,
      new_value: newGrant,
      sensitive: true,
      public_message: `Grant reissued from #${source.id}${reason ? ": " + reason : ""}`,
    });
  } catch (e) {
    console.error("Failed to write audit log for reissue_project_grant", e);
  }

  return newGrant;
});
