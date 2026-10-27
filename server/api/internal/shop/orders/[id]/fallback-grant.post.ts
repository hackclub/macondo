import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { createHcbClient, hcbCardGrantWebUrl } from "../../../../../lib/hcb";
import { notify } from "../../../../../lib/notify";
import {
  buildShopItemSnapshot,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
} from "../../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

type FallbackBody = {
  amount_cents?: number;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error &&
    "statusMessage" in error &&
    typeof error.statusMessage === "string"
  ) {
    return error.statusMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const amountCents = Number(
    (await readBody<FallbackBody>(event).catch(() => ({})))?.amount_cents,
  );
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "amount_cents must be a positive integer",
    });
  }

  const orderContext = await getShopOrderContext(id);
  if (!orderContext || !orderContext.item || !orderContext.orderUser) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const snapshot = orderContext.item
    ? getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item)
    : getOrderItemSnapshot(orderContext.order);

  if (!snapshot || snapshot.kind !== "physical") {
    throw createError({
      statusCode: 400,
      statusMessage: "Fallback grants are only for physical-item orders",
    });
  }

  if (orderContext.order.external_reference) {
    throw createError({
      statusCode: 409,
      statusMessage: "This order already has an external reference. Return it before creating a fallback grant.",
    });
  }

  const config = useRuntimeConfig();
  if (!config.hcbOrganizationId) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB organization ID not configured",
    });
  }

  const recipientEmail =
    orderContext.orderUser.hcb_email ?? orderContext.orderUser.email ?? null;
  if (!recipientEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: "User does not have an email available for HCB grant delivery",
    });
  }

  const purposeSuffix = " Fallback";
  const purpose = `${snapshot.name.trim().slice(0, 30 - purposeSuffix.length) || "Shop item"}${purposeSuffix}`; // hcb grant purpose max length

  try {
    const response = await createHcbClient().createOrganizationCardGrant(
      String(config.hcbOrganizationId),
      {
        amount_cents: amountCents,
        email: recipientEmail,
        purpose,
        invite_message: `We couldn't fulfill your ${snapshot.name} shop order directly, so here's a grant instead. Use this card to buy the item yourself and upload your receipt. The card locks automatically after one transaction.`,
        sent_by_email: true,
        // Locks the card after the first authorization so it can't fund a second purchase.
        one_time_use: true,
      },
    );

    const grant = Array.isArray(response) ? response[0] : response;
    if (!grant?.id) {
      throw createError({
        statusCode: 502,
        statusMessage: "HCB did not return a card grant ID",
      });
    }
    const grantId = String(grant.id);

    const [updatedOrder] = await db
      .update(shopOrderTable)
      .set({
        status: "grant_created",
        external_reference: grantId,
        fulfillment_error: null,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();

    if (!updatedOrder) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to update order after HCB fallback grant creation",
      });
    }

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "create_shop_fallback_grant",
        entity_type: "shop_order",
        entity_id: String(id),
        old_value: orderContext.order,
        new_value: updatedOrder,
        sensitive: true,
        public_message: `Fallback HCB grant created: $${(amountCents / 100).toFixed(2)}`,
        change_summary: snapshot.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for shop fallback grant", error);
    }

    const amountUsd = (amountCents / 100).toFixed(2);
    const hcbGrantUrl = hcbCardGrantWebUrl(grantId);
    void notify({
      user_id: orderContext.order.user_id,
      type: "shop_grant_fallback_sent",
      title: `$${amountUsd} fallback grant sent: ${snapshot.name}`,
      body: `We couldn't fulfill your shop order directly, so your grant has been sent instead. Check your email for the HCB invite, or open the grant directly.`,
      action_url: hcbGrantUrl,
      entity_type: "shop_order",
      entity_id: String(id),
      slack: {
        text: `:shopping_bags: $${amountUsd} *fallback* grant sent for *${snapshot.name}* by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""}`,
      },
      email: {
        template: "shop_grant_fallback_sent",
        data: {
          item_name: snapshot.name,
          amount_usd: `$${amountUsd} USD`,
          hcb_grant_url: hcbGrantUrl,
        },
      },
    });

    return formatShopOrderForResponse({
      order: updatedOrder,
      item: orderContext.item,
      orderUser: orderContext.orderUser,
    }, {
      includeShippingAddress: true,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error, "HCB fallback grant creation failed");
    const [updatedOrder] = await db
      .update(shopOrderTable)
      .set({
        status: "external_failure",
        fulfillment_error: errorMessage,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();

    throw createError({
      statusCode: 502,
      statusMessage: updatedOrder?.fulfillment_error ?? errorMessage,
    });
  }
});
