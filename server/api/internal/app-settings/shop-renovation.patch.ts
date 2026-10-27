import { canAccessInternalShopAdmin } from "../../../policies/internal";
import {
  isShopUnderRenovation,
  setShopUnderRenovation,
} from "../../../lib/app-settings";
import { writeAudit } from "../../../lib/audit";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = (await readBody<{ enabled?: boolean }>(event)) ?? {};
  if (typeof body.enabled !== "boolean") {
    throw createError({
      statusCode: 400,
      statusMessage: "enabled must be a boolean",
    });
  }

  const previous = await isShopUnderRenovation();
  if (previous === body.enabled) {
    return { enabled: body.enabled };
  }

  await setShopUnderRenovation(body.enabled, actor.id);

  await writeAudit({
    actor_id: actor.id,
    action: body.enabled ? "shop_renovation_enable" : "shop_renovation_disable",
    entity_type: "app_setting",
    entity_id: "shop_under_renovation",
    old_value: { enabled: previous },
    new_value: { enabled: body.enabled },
    change_summary: body.enabled
      ? "Shop placed under renovation (all items hidden from public shop)"
      : "Shop renovation lifted (items visible again)",
  });

  return { enabled: body.enabled };
});
