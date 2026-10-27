import { and, eq } from "drizzle-orm";

import db from "../../../../db";
import { macondoBanTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { canBanUser } from "../../../../policies/internal";

// Deactivates rather than deletes to keep the audit trail. The user is NOT
// auto-re-invited to Slack; they can rejoin once the re-kick stops firing.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canBanUser(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;

  await db
    .update(macondoBanTable)
    .set({
      active: false,
      lifted_at: new Date(),
      lifted_by_user_id: actor.id,
    })
    .where(
      and(eq(macondoBanTable.user_id, id), eq(macondoBanTable.active, true)),
    );

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "lift_macondo_ban",
      entity_type: "user",
      entity_id: id,
      old_value: null,
      new_value: { lifted_by: actor.id },
      sensitive: true,
      public_message: null,
    });
  } catch (e) {
    console.error("Failed to write audit log for lifting macondo ban", e);
  }

  return { ok: true };
});
