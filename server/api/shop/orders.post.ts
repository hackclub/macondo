import { and, eq, gte, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import db from "../../db";
import {
  currencyTransactionTable,
  shopItemTable,
  shopItemUnlockTable,
  shopOrderTable,
  users,
} from "../../db/schema";
import {
  buildShopItemSnapshot,
  canPurchaseWithPendingGold,
  canPurchaseWithPriorityGold,
  clearShopCheckoutAddress,
  formatShopOrderForResponse,
  getShopCheckoutAddress,
  isShopItemPurchasableInRegion,
  notifyOrganizersOfEventInvite,
  priceHoursToGold,
  requiresCheckoutAddress,
  resolveItemPriceHours,
  createTheseusLetterForOrder,
  syncAccommodationCountToAirtable,
  validateAndResolveSelectedModifiers,
  STREAK_FREEZE_SLUG,
  EVENT_INVITE_SLUG,
  type SelectedModifierInput,
} from "../../lib/shop";
import { addUserToEventChannel } from "../../lib/event-channel";
import { setEventQualifiedFlag } from "../../lib/loops";
import {
  resolveAvailabilityRegion,
  resolveBrowsingRegion,
  resolveOrderRegion,
} from "../../lib/shop-region";
import { REGION_LABEL } from "../../lib/regions";
import { assertFirstPartyRequest } from "../../lib/first-party";
import { checkRateLimits } from "../../lib/rate-limit";
import { getSession } from "../../lib/session";
import { getBannedUserIds } from "../../lib/hackatime";
import { userHasShippedProject } from "../../lib/ships";
import { MAX_STREAK_FREEZES } from "../../lib/streaks";

// Abuse control, not anti-sniping: failed attempts count on purpose, and drops
// are bounded by stock_remaining and max_per_user in the transaction below.
const ORDER_RATE_WINDOWS: Array<[limit: number, windowSeconds: number]> = [
  [5, 10],
  [20, 60],
  [60, 3600],
];

// Capped so one note can't bloat the row or the fulfiller UI.
const FULFILLMENT_NOTE_MAX_LENGTH = 1000;

function sanitizeFulfillmentNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 9 || code === 10) return true;
      return code >= 32 && code !== 127; // drop control chars and del
    })
    .join("")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > FULFILLMENT_NOTE_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Note to fulfillers must be ${FULFILLMENT_NOTE_MAX_LENGTH} characters or fewer`,
    });
  }
  return cleaned;
}

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
  // Header-only, so it runs before the session lookup; see server/lib/first-party.ts.
  assertFirstPartyRequest(event);

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rate = await checkRateLimits(user.id, "shop-order:user", ORDER_RATE_WINDOWS);
  if (!rate.allowed) {
    setResponseHeader(event, "Retry-After", rate.retryAfterSeconds);
    throw createError({
      statusCode: 429,
      statusMessage: `You're checking out too quickly. Try again in ${rate.retryAfterSeconds} seconds.`,
      data: { retryAfterSeconds: rate.retryAfterSeconds },
    });
  }

  // Hackatime-red users can't buy; any order that slips through is cancelled by red-order-guard-cron.ts.
  if ((await getBannedUserIds([user.id])).has(user.id)) {
    throw createError({
      statusCode: 403,
      statusMessage: "Your account can't place shop orders.",
    });
  }

  const body = (await readBody<{
    itemId?: number | string;
    quantity?: number;
    addressId?: string;
    selectedModifiers?: SelectedModifierInput[];
    note?: string;
  }>(event)) ?? {};

  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw createError({
      statusCode: 400,
      statusMessage: "Quantity must be between 1 and 999",
    });
  }

  // Validated before the transaction; only persisted for physical orders.
  const fulfillmentNote = sanitizeFulfillmentNote(body.note);

  // Slugs are a back-compat shim for stale bundles that sent string ids like "streak_freeze".
  let itemId: number;
  if (typeof body.itemId === "string") {
    const trimmed = body.itemId.trim();
    if (!trimmed) {
      throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
    }
    const asNumber = Number(trimmed);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      itemId = asNumber;
    } else {
      const [bySlug] = await db
        .select({ id: shopItemTable.id })
        .from(shopItemTable)
        .where(eq(shopItemTable.slug, trimmed))
        .limit(1);
      if (!bySlug) {
        throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
      }
      itemId = bySlug.id;
    }
  } else {
    itemId = Number(body.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
    }
  }

  // Synthetic items route by slug before the purchase transaction; streak freezes bypass shop_orders.
  const [routedItem] = await db
    .select({
      id: shopItemTable.id,
      slug: shopItemTable.slug,
      fulfillment_provider: shopItemTable.fulfillment_provider,
      coming_soon: shopItemTable.coming_soon,
      requires_shipped_project: shopItemTable.requires_shipped_project,
    })
    .from(shopItemTable)
    .where(eq(shopItemTable.id, itemId))
    .limit(1);
  if (!routedItem) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }
  if (routedItem.fulfillment_provider === "internal_synthetic") {
    if (routedItem.coming_soon === true) {
      throw createError({
        statusCode: 400,
        statusMessage: "This item is coming soon and cannot be purchased yet",
      });
    }
    if (
      routedItem.requires_shipped_project === true &&
      !(await userHasShippedProject(user.id))
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "You need to ship a project before purchasing this item",
      });
    }
    // Synthetic items have no modifiers; refuse forged selections rather than dropping them.
    if (Array.isArray(body.selectedModifiers) && body.selectedModifiers.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "This item does not accept modifier selections",
      });
    }
    if (routedItem.slug === STREAK_FREEZE_SLUG) {
      return handleStreakFreezePurchase(user.id, routedItem.id, quantity);
    }
    // Event Invite falls through to the normal order flow; other synthetic slugs have no handler yet.
    if (routedItem.slug !== EVENT_INVITE_SLUG) {
      throw createError({
        statusCode: 400,
        statusMessage: "This item is not yet available for purchase",
      });
    }
  }

  const checkoutAddress = getShopCheckoutAddress(event);
  const selectedCheckoutAddress =
    body.addressId && checkoutAddress?.addresses.length
      ? checkoutAddress.addresses.find((entry) => entry.id === body.addressId)
      : checkoutAddress?.addresses.find((entry) => entry.primary) ??
        checkoutAddress?.addresses[0] ??
        (checkoutAddress
          ? {
              id: "primary",
              label: "",
              primary: true,
              shippingAddress: checkoutAddress.shippingAddress,
              phone: checkoutAddress.phone,
            }
          : null);

  const now = new Date();

  const purchaseResult = await db.transaction(async (tx) => {
    // Per-user lock so concurrent orders can't double-spend on a stale balance.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${user.id})::bigint)`,
    );

    const [item] = await tx
      .select()
      .from(shopItemTable)
      .where(eq(shopItemTable.id, itemId))
      .limit(1);

    if (!item) {
      throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
    }

    if (item.requires_shipped_project && !(await userHasShippedProject(user.id))) {
      throw createError({
        statusCode: 400,
        statusMessage: "You need to ship a project before purchasing this item",
      });
    }

    // Read fresh: the session snapshot can lag a just-completed HCA verification.
    const [verifiedRow] = await tx
      .select({
        status: users.hca_verification_status,
        yswsEligible: users.hca_ysws_eligible,
        isSystem: users.is_system,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // Staff test accounts (users.is_system) skip both buyer gates, like isStaffTestAccount in server/lib/ships.ts.
    if (verifiedRow?.isSystem !== true) {
      if (verifiedRow?.status !== "verified") {
        throw createError({
          statusCode: 403,
          statusMessage:
            "You need to verify your identity with Hack Club before buying from the shop.",
        });
      }

      // Only an explicit false blocks (null = HCA never answered). Deliberately
      // no age check: gold earned while eligible stays spendable after aging out.
      if (verifiedRow.yswsEligible === false) {
        throw createError({
          statusCode: 403,
          statusMessage:
            "Hack Club Auth reports your account isn't eligible for YSWS programs, so you can't buy from the shop. If you think that's wrong, check your details at auth.hackclub.com, then sign back in and try again.",
        });
      }
    }

    // Checked inside the purchase transaction to avoid a TOCTOU gap with the unlock.
    if (item.extra_fruity === true) {
      const [unlockRow] = await tx
        .select({ id: shopItemUnlockTable.id })
        .from(shopItemUnlockTable)
        .where(
          and(
            eq(shopItemUnlockTable.user_id, user.id),
            eq(shopItemUnlockTable.item_id, item.id),
          ),
        )
        .limit(1);
      if (!unlockRow) {
        throw createError({
          statusCode: 403,
          statusMessage: "This item is locked. Unlock it with a starfruit first.",
        });
      }
    }

    // Physical items price by shipping country so a manual override can't dodge prices.
    const browsingRegion = resolveBrowsingRegion(event, user);
    const orderRegion = resolveOrderRegion(
      item.kind,
      selectedCheckoutAddress?.shippingAddress?.country ?? null,
      browsingRegion,
    );

    // Separate from orderRegion so grants are region-gated while their pricing stays global.
    const availabilityRegion = resolveAvailabilityRegion(
      item.kind,
      selectedCheckoutAddress?.shippingAddress?.country ?? null,
      browsingRegion,
    );

    if (!isShopItemPurchasableInRegion(item, availabilityRegion, now)) {
      // Name the shipping region so a buyer browsing elsewhere understands the block.
      const regionLabel = availabilityRegion ? REGION_LABEL[availabilityRegion] : null;
      throw createError({
        statusCode: 400,
        statusMessage: regionLabel
          ? `This item can't be purchased for ${regionLabel}.`
          : "This item is not currently available for purchase in your region",
      });
    }

    // Failed and cancelled orders free their slot; in-transaction so concurrent buys can't race the cap.
    if (item.max_per_user != null) {
      const [ownedRow] = await tx
        .select({
          owned: sql<number>`COALESCE(SUM(${shopOrderTable.quantity}), 0)`.mapWith(Number),
        })
        .from(shopOrderTable)
        .where(
          and(
            eq(shopOrderTable.user_id, user.id),
            eq(shopOrderTable.item_id, item.id),
            notInArray(shopOrderTable.status, ["external_failure", "cancelled"]),
          ),
        );
      const owned = Number(ownedRow?.owned ?? 0);
      if (owned + quantity > item.max_per_user) {
        const remaining = Math.max(0, item.max_per_user - owned);
        throw createError({
          statusCode: 400,
          statusMessage:
            remaining <= 0
              ? `You've already reached the limit of ${item.max_per_user} for this item`
              : `You can only purchase ${remaining} more of this item (limit ${item.max_per_user} per person)`,
        });
      }
    }

    const needsCheckoutAddress = requiresCheckoutAddress(item);
    if (needsCheckoutAddress && !selectedCheckoutAddress?.shippingAddress) {
      const addressKind = item.kind === "grant" ? "billing" : "shipping";
      const itemKindLabel = item.kind === "grant" ? "grant" : "physical";
      throw createError({
        statusCode: 400,
        statusMessage: body.addressId
          ? `Choose a valid Hack Club Auth ${addressKind} address before purchasing ${itemKindLabel} items`
          : `Confirm your ${addressKind} address with Hack Club Auth before purchasing ${itemKindLabel} items`,
      });
    }

    const basePriceHours = resolveItemPriceHours(item, orderRegion);
    const { resolved: resolvedModifiers, priceHoursPerUnit } =
      validateAndResolveSelectedModifiers(
        item.modifiers,
        body.selectedModifiers,
        basePriceHours,
      );
    const totalPriceGold = priceHoursToGold(priceHoursPerUnit) * quantity;

    // Legacy items can carry fractional prices; never write fractional gold to the ledger.
    if (!Number.isInteger(totalPriceGold)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "This item has an invalid price right now and can't be purchased. Please let us know so we can fix it.",
      });
    }

    // Pending gold only funds event-tied items; the debit may leave the balance
    // negative until it unlocks, so it can't fund a second purchase.
    if (totalPriceGold > 0) {
      const balanceConditions = [
        eq(currencyTransactionTable.user_id, user.id),
        eq(currencyTransactionTable.counts, true),
        // Gold-only: fruit rows are a separate currency.
        isNull(currencyTransactionTable.fruit_type),
      ];
      if (!canPurchaseWithPendingGold(item.slug)) {
        balanceConditions.push(isNotNull(currencyTransactionTable.unlocked_at));
      }
      // Priority-payout gold only funds the priority catalog. Only increase rows
      // carry priority=true, so a plain column filter is exact.
      const priorityGoldLocked = !canPurchaseWithPriorityGold(item);
      const conditionsIncludingPriorityGold = [...balanceConditions];
      if (priorityGoldLocked) {
        balanceConditions.push(eq(currencyTransactionTable.priority, false));
      }
      const [balanceResult] = await tx
        .select({
          balance: sql<number>`
            COALESCE(SUM(
              CASE WHEN ${currencyTransactionTable.type} = 'increase'
                THEN ${currencyTransactionTable.amount}
                ELSE -${currencyTransactionTable.amount}
              END
            ), 0)
          `.mapWith(Number),
        })
        .from(currencyTransactionTable)
        .where(and(...balanceConditions));

      if ((balanceResult?.balance ?? 0) < totalPriceGold) {
        // Explain a browse-vs-shipping region price gap instead of a bare shortfall.
        // Modifier deltas are region-independent.
        const browseTotalGold =
          priceHoursToGold(
            Math.max(
              0,
              resolveItemPriceHours(item, browsingRegion) +
                (priceHoursPerUnit - basePriceHours),
            ),
          ) * quantity;
        if (orderRegion && browseTotalGold !== totalPriceGold) {
          throw createError({
            statusCode: 400,
            statusMessage:
              `This item costs ${totalPriceGold} gold when shipping to ` +
              `${REGION_LABEL[orderRegion]} (you were viewing ` +
              `${browseTotalGold} gold for ${REGION_LABEL[browsingRegion]}). ` +
              `You have ${balanceResult?.balance ?? 0} gold.`,
          });
        }
        // The shop's displayed balance includes priority gold, so explain when that's the gap.
        if (priorityGoldLocked) {
          const [withPriority] = await tx
            .select({
              balance: sql<number>`
                COALESCE(SUM(
                  CASE WHEN ${currencyTransactionTable.type} = 'increase'
                    THEN ${currencyTransactionTable.amount}
                    ELSE -${currencyTransactionTable.amount}
                  END
                ), 0)
              `.mapWith(Number),
            })
            .from(currencyTransactionTable)
            .where(and(...conditionsIncludingPriorityGold));
          const totalWithPriority = withPriority?.balance ?? 0;
          if (totalWithPriority >= totalPriceGold) {
            const spendable = balanceResult?.balance ?? 0;
            throw createError({
              statusCode: 400,
              statusMessage:
                `You have ${totalWithPriority} gold, but ` +
                `${totalWithPriority - spendable} of it came from priority ` +
                `reviews and can only be spent on select event items. Only ` +
                `${Math.max(0, spendable)} gold is spendable on this item ` +
                `(it costs ${totalPriceGold}).`,
            });
          }
        }
        throw createError({
          statusCode: 400,
          statusMessage: "You do not have enough gold for this purchase",
        });
      }
    }

    if (item.inventory_mode === "limited") {
      const restockRows = await tx
        .update(shopItemTable)
        .set({
          stock_remaining: sql`${shopItemTable.stock_remaining} - ${quantity}`,
          updated_at: now,
        })
        .where(
          and(
            eq(shopItemTable.id, item.id),
            eq(shopItemTable.inventory_mode, "limited"),
            gte(shopItemTable.stock_remaining, quantity),
          ),
        )
        .returning({ id: shopItemTable.id });

      if (restockRows.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: "This item does not have enough stock remaining",
        });
      }
    }

    const itemSnapshot = buildShopItemSnapshot(item, orderRegion, {
      resolvedModifiers,
      priceHoursPerUnit,
    });
    const initialStatus =
      item.kind === "virtual_service"
        ? "service_activated"
        : item.fulfillment_provider === "hcb"
          ? "grant_pending"
          : item.fulfillment_provider === "theseus"
            ? "theseus_submitted"
            : "pending_internal_fulfillment";

    const [createdOrder] = await tx
      .insert(shopOrderTable)
      .values({
        user_id: user.id,
        item_id: item.id,
        quantity,
        status: initialStatus,
        item_snapshot: itemSnapshot,
        selected_modifiers: resolvedModifiers.length > 0 ? resolvedModifiers : null,
        shipping_address: needsCheckoutAddress
          ? selectedCheckoutAddress?.shippingAddress ?? null
          : null,
        phone: needsCheckoutAddress ? selectedCheckoutAddress?.phone ?? null : null,
        // Only a human fulfiller reads notes, so keep them for physical orders only.
        fulfillment_note: item.kind === "physical" ? fulfillmentNote : null,
        region: orderRegion,
        created_at: now,
        updated_at: now,
      })
      .returning();

    if (!createdOrder) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to create shop order",
      });
    }

    // Capped so the memo stays under the column limit.
    const modifierMemoFragment = (() => {
      if (resolvedModifiers.length === 0) return "";
      const joined = resolvedModifiers
        .map((m) => `${m.modifier_label}: ${m.options.map((o) => o.label).join(", ")}`)
        .join("; ");
      const truncated =
        joined.length > 100 ? `${joined.slice(0, 97)}...` : joined;
      return ` [${truncated}]`;
    })();

    if (totalPriceGold > 0) {
      await tx.insert(currencyTransactionTable).values({
        user_id: user.id,
        amount: totalPriceGold,
        type: "decrease",
        source: "shop_purchase",
        shop_order_id: createdOrder.id,
        memo: `Shop purchase: ${itemSnapshot.name}${modifierMemoFragment} x${quantity}`,
        counts: true,
      });
    }

    return {
      item,
      order: createdOrder,
    };
  });

  let responseOrder = purchaseResult.order;
  clearShopCheckoutAddress(event);

  if (purchaseResult.item.fulfillment_provider === "theseus") {
    try {
      const { letterId } = await createTheseusLetterForOrder(responseOrder.id);
      const [updatedOrder] = await db
        .update(shopOrderTable)
        .set({
          status: "theseus_submitted",
          tracking_number: letterId,
          external_reference: letterId,
          fulfillment_error: null,
          updated_at: new Date(),
        })
        .where(eq(shopOrderTable.id, responseOrder.id))
        .returning();

      if (updatedOrder) {
        responseOrder = updatedOrder;
      }
    } catch (error) {
      const [updatedOrder] = await db
        .update(shopOrderTable)
        .set({
          status: "external_failure",
          fulfillment_error: getErrorMessage(error, "Theseus submission failed"),
          updated_at: new Date(),
        })
        .where(eq(shopOrderTable.id, responseOrder.id))
        .returning();

      if (updatedOrder) {
        responseOrder = updatedOrder;
      }
    }
  }

  // Fire-and-forget so a Slack issue never blocks the purchase response.
  if (purchaseResult.item.slug === EVENT_INVITE_SLUG) {
    void addUserToEventChannel(user.id);
    if (user.email) {
      void setEventQualifiedFlag({
        email: user.email,
        slack_id: user.slack_id,
        qualified: true,
      });
    }
    void notifyOrganizersOfEventInvite({
      buyerUsername: user.username ?? null,
      buyerSlackId: user.slack_id ?? null,
      buyerId: user.id,
      orderId: responseOrder.id,
      itemName: purchaseResult.item.name,
      quantity,
    });
  }

  // No-op for non-accommodation slugs.
  void syncAccommodationCountToAirtable(user.id, purchaseResult.item.slug);

  return {
    ...formatShopOrderForResponse(
      {
        order: responseOrder,
        item: purchaseResult.item,
        orderUser: null,
      },
      { includeFulfillmentError: false },
    ),
    message:
      responseOrder.status === "external_failure"
        ? "Purchase completed, but the external fulfillment step needs staff attention."
        : responseOrder.status === "service_activated"
          ? "Service activated successfully."
        : "Purchase completed successfully.",
  };
});

async function handleStreakFreezePurchase(
  userId: string,
  itemId: number,
  quantity: number,
) {
  return db.transaction(async (tx) => {
    // Same per-user lock as the main order path.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`,
    );

    // Charge the configured price so the admin editor stays the single source of truth.
    const [item] = await tx
      .select({
        price_hours: shopItemTable.price_hours,
        priority_eligible: shopItemTable.priority_eligible,
      })
      .from(shopItemTable)
      .where(eq(shopItemTable.id, itemId))
      .limit(1);
    if (!item) {
      throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
    }
    const totalPriceGold = priceHoursToGold(item.price_hours) * quantity;

    const [currentUser] = await tx
      .select({
        streak_freezes_remaining: users.streak_freezes_remaining,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    const currentFreezes = currentUser?.streak_freezes_remaining ?? 0;
    if (currentFreezes + quantity > MAX_STREAK_FREEZES) {
      const room = Math.max(0, MAX_STREAK_FREEZES - currentFreezes);
      throw createError({
        statusCode: 400,
        statusMessage:
          room === 0
            ? `Your stash is already at the cap of ${MAX_STREAK_FREEZES} streak freezes.`
            : `You can only buy ${room} more streak freeze${room === 1 ? "" : "s"} before hitting the cap of ${MAX_STREAK_FREEZES}.`,
      });
    }

    const [balanceResult] = await tx
      .select({
        balance: sql<number>`
          COALESCE(SUM(
            CASE WHEN ${currencyTransactionTable.type} = 'increase'
              THEN ${currencyTransactionTable.amount}
              ELSE -${currencyTransactionTable.amount}
            END
          ), 0)
        `.mapWith(Number),
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, userId),
          eq(currencyTransactionTable.counts, true),
          // Gold-only, same as the main order path.
          isNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
          // Same helper as the main path so the two can't drift.
          ...(canPurchaseWithPriorityGold({
            slug: STREAK_FREEZE_SLUG,
            priority_eligible: item.priority_eligible,
          })
            ? []
            : [eq(currencyTransactionTable.priority, false)]),
        ),
      );

    if ((balanceResult?.balance ?? 0) < totalPriceGold) {
      throw createError({
        statusCode: 400,
        statusMessage: "You do not have enough gold for this purchase",
      });
    }

    await tx.insert(currencyTransactionTable).values({
      user_id: userId,
      amount: totalPriceGold,
      type: "decrease",
      source: "shop_purchase",
      memo: `Streak Freeze x${quantity}`,
      counts: true,
    });

    const [updatedUser] = await tx
      .update(users)
      .set({
        streak_freezes_remaining: sql`${users.streak_freezes_remaining} + ${quantity}`,
      })
      .where(eq(users.id, userId))
      .returning({
        streak_freezes_remaining: users.streak_freezes_remaining,
      });

    return {
      ok: true as const,
      synthetic: true as const,
      item_id: STREAK_FREEZE_SLUG,
      quantity,
      total_price_gold: totalPriceGold,
      streak_freezes_remaining: updatedUser?.streak_freezes_remaining ?? 0,
      message: `Streak freeze${quantity > 1 ? "s" : ""} added to your stash.`,
    };
  });
}
