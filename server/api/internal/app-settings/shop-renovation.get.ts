import { canAccessInternalShopAdmin } from "../../../policies/internal";
import { isShopUnderRenovation } from "../../../lib/app-settings";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const enabled = await isShopUnderRenovation();
  return { enabled };
});
