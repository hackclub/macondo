import db from "../../../../db";
import { shadowBanTable } from "../../../../db/schema";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "../../../../lib/audit";
import { isAbleToReview } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;

  // Capture active bans first so the audit trail records what was reversed.
  const activeBans = await db
    .select()
    .from(shadowBanTable)
    .where(and(eq(shadowBanTable.user_id, id), eq(shadowBanTable.active, true)));

  await db
    .update(shadowBanTable)
    .set({ active: false })
    .where(eq(shadowBanTable.user_id, id));

  if (activeBans.length > 0) {
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "remove_shadow_ban",
        entity_type: "user",
        entity_id: id,
        old_value: { active_bans: activeBans },
        new_value: { active: false },
        sensitive: true,
        public_message: "Shadow ban lifted.",
        change_summary: `Lifted ${activeBans.length} shadow ban(s)`,
      });
    } catch (err) {
      console.error("Failed to write audit log for shadow-ban lift", err);
    }
  }

  return { ok: true };
});
