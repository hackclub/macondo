import { formatShopOrderForResponse } from "../../../../../lib/shop";
import { cancelShopOrder } from "../../../../../lib/shop-order-cancel";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const reason =
    (await readBody<{ reason?: string }>(event).catch(() => ({})))?.reason?.trim() || null;

  const result = await cancelShopOrder({ orderId: id, actorId: actor.id, reason });

  if (!result.cancelled) {
    return formatShopOrderForResponse(result.context, {
      includeShippingAddress: true,
    });
  }

  return {
    ...formatShopOrderForResponse(result.context, { includeShippingAddress: true }),
    refunded: result.refunded,
    revokedCertificate: result.revokedCertificate,
    // Theseus has no recall API, so the admin must contact the user directly.
    theseusWarning:
      result.previousStatus === "theseus_submitted" &&
      !!result.context.item &&
      result.context.item.fulfillment_provider === "theseus"
      ? "Refunded. The Theseus letter may already be in the mail; contact the user if recall is needed."
      : null,
  };
});
