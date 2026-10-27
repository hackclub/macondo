import { listPendingShopChanges } from "../../../lib/shop-slack-log";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return { changes: await listPendingShopChanges() };
});
