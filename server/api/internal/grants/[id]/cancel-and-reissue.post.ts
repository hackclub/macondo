import { and, eq, inArray, ne } from "drizzle-orm";

import db from "../../../../db";
import { projectGrantTable, shipTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { roundUpHardwareGrantCents } from "../../../../lib/grants";
import { createHcbClient } from "../../../../lib/hcb";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

// No "grant cancelled" notice: the recipient hears about the new card when it's Sent.
// Mirrors cancel.post.ts (HCB-first) and reissue.post.ts ($10 rounding); keep the three aligned.
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
  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reason is required",
    });
  }

  const [source] = await db
    .select()
    .from(projectGrantTable)
    .where(eq(projectGrantTable.id, id))
    .limit(1);

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: "Grant not found" });
  }
  if (source.status !== "queued" && source.status !== "sent") {
    throw createError({
      statusCode: 409,
      statusMessage: `Grant is ${source.status}; only queued or sent grants can be cancelled and reissued. Use Reissue on an already-cancelled grant.`,
    });
  }

  // The partial unique index should prevent this; bail cleanly rather than tripping it on insert.
  const [otherActive] = await db
    .select({ id: projectGrantTable.id })
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.ship_id, source.ship_id),
        ne(projectGrantTable.id, source.id),
        inArray(projectGrantTable.status, ["queued", "sent"]),
      ),
    )
    .limit(1);
  if (otherActive) {
    throw createError({
      statusCode: 409,
      statusMessage: `Another active grant (#${otherActive.id}) already exists for this ship.`,
    });
  }

  // Compute the amount before cancelling on HCB so we never cancel with nothing valid to reissue.
  const [ship] = await db
    .select({
      needs_funding_amount_cents: shipTable.needs_funding_amount_cents,
    })
    .from(shipTable)
    .where(eq(shipTable.id, source.ship_id))
    .limit(1);

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

  // Cancel on HCB first; if it refuses, leave our rows untouched so the admin can retry.
  if (source.status === "sent" && source.hcb_grant_id) {
    try {
      await createHcbClient().cancelCardGrant(source.hcb_grant_id);
    } catch (err) {
      const msg =
        (err as { statusMessage?: string; message?: string })?.statusMessage ??
        (err as Error)?.message ??
        "HCB cancel failed";
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "cancel_project_grant_failed",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: source,
          new_value: {
            error: msg,
            reason,
            hcb_stage: "hcb_refused",
            flow: "reissue",
          },
          sensitive: true,
          public_message: `HCB refused to cancel grant for reissue: ${msg}`,
        });
      } catch (e) {
        console.error(
          "Failed to write audit log for cancel_project_grant_failed",
          e,
        );
      }
      throw createError({
        statusCode: 502,
        statusMessage: `HCB refused to cancel the grant: ${msg}`,
      });
    }
  }

  // One transaction so a cancelled grant never lacks its replacement; no fruit fallback since it's a fresh card.
  const { cancelledGrant, newGrant } = await db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(projectGrantTable)
      .set({
        status: "cancelled",
        cancelled_by_user_id: actor.id,
        cancelled_at: new Date(),
        cancel_reason: reason,
        cancel_fruit_tx_id: null,
        updated_at: new Date(),
      })
      .where(eq(projectGrantTable.id, id))
      .returning();
    if (!cancelled) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to cancel grant",
      });
    }

    const [created] = await tx
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
    if (!created) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to queue reissued grant",
      });
    }

    return { cancelledGrant: cancelled, newGrant: created };
  });

  // Two audit rows so consumers keyed on either action see this, same as the manual flow.
  try {
    await writeAudit({
      actor_id: actor.id,
      action: "cancel_project_grant",
      entity_type: "project_grant",
      entity_id: String(id),
      old_value: source,
      new_value: cancelledGrant,
      sensitive: true,
      public_message: `Grant cancelled for reissue (no payout): ${reason}`,
    });
  } catch (e) {
    console.error("Failed to write audit log for cancel_project_grant", e);
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "reissue_project_grant",
      entity_type: "project_grant",
      entity_id: String(newGrant.id),
      old_value: source,
      new_value: newGrant,
      sensitive: true,
      public_message: `Grant reissued from #${source.id} (cancelled active card): ${reason}`,
    });
  } catch (e) {
    console.error("Failed to write audit log for reissue_project_grant", e);
  }

  return newGrant;
});
