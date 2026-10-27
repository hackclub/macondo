import { writeAudit } from "../../../lib/audit";
import { publishPendingShopChanges } from "../../../lib/shop-slack-log";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

// Slack errors bubble up with the queue intact so the admin can retry.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const result = await publishPendingShopChanges();

  if (result.published > 0) {
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "publish_shop_changes",
        entity_type: "shop_item",
        entity_id: "bulk",
        old_value: null,
        new_value: { published: result.published },
        sensitive: true,
        public_message: "Published queued shop changes to Slack",
        change_summary: `${result.published} item${result.published === 1 ? "" : "s"}`,
      });
    } catch (error) {
      console.error("Failed to write audit log for shop change publish", error);
    }
  }

  return result;
});
