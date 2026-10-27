import { canAccessInternalShopAdmin } from "../../../policies/internal";
import { clusterShopRequests } from "../../../lib/shop-request-cluster";
import { backfillRecentShopRequestTags } from "../../../lib/shop-request-tag";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const tagResult = await backfillRecentShopRequestTags(14);
  const { scanned, clustered } = await clusterShopRequests();
  return {
    ok: true,
    tagged: tagResult.tagged,
    tagTotal: tagResult.scanned,
    clustered,
    total: scanned,
  };
});
