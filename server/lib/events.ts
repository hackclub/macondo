import { and, eq, gte, sql } from "drizzle-orm";

import db from "../db";
import {
  currencyTransactionTable,
  eventAttendeeTable,
  eventTable,
  shopItemTable,
  shopOrderTable,
} from "../db/schema";
import { writeAudit } from "./audit";
import { notify } from "./notify";
import { buildShopItemSnapshot } from "./shop";

export type EventRow = typeof eventTable.$inferSelect;
export type EventAttendeeRow = typeof eventAttendeeTable.$inferSelect;

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// Baked once at publish time, so it can't localize per-user; show a UTC stamp instead.
function formatEventWhen(event: EventRow): string {
  if (!event.starts_at) return "";
  const s = event.starts_at.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return event.timezone ? `${s} (${event.timezone})` : s;
}

export function composeEventAnnouncementBody(event: EventRow): string {
  const parts: string[] = [];
  if (event.description?.trim()) parts.push(event.description.trim());
  const meta: string[] = [];
  const when = formatEventWhen(event);
  if (when) meta.push(`**When:** ${when}`);
  if (event.location?.trim()) meta.push(`**Where:** ${event.location.trim()}`);
  if (meta.length) parts.push(meta.join("\n"));
  return parts.join("\n\n");
}

export function formatEventForResponse(
  event: EventRow,
  extra?: {
    attendee_count?: number;
    winner_count?: number;
    proposed_gift_count?: number;
    creator_name?: string | null;
  },
) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    image_url: event.image_url,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    timezone: event.timezone,
    status: event.status,
    announced_at: event.announced_at,
    announcement_id: event.announcement_id,
    created_by: event.created_by,
    created_at: event.created_at,
    updated_at: event.updated_at,
    attendee_count: extra?.attendee_count ?? 0,
    winner_count: extra?.winner_count ?? 0,
    proposed_gift_count: extra?.proposed_gift_count ?? 0,
    creator_name: extra?.creator_name ?? null,
  };
}

export function formatAttendeeForResponse(
  row: EventAttendeeRow,
  user: { id: string; name: string | null; username: string | null; image: string | null } | null,
  giftItemName?: string | null,
) {
  return {
    id: row.id,
    user_id: row.user_id,
    user_name: user?.name ?? null,
    user_username: user?.username ?? null,
    user_image: user?.image ?? null,
    is_winner: row.is_winner,
    attended_at: row.attended_at,
    rsvp_status: row.rsvp_status,
    rsvp_source: row.rsvp_source,
    rsvp_at: row.rsvp_at,
    gift_kind: row.gift_kind,
    gift_gold_amount: row.gift_gold_amount,
    gift_shop_item_id: row.gift_shop_item_id,
    gift_shop_item_name: giftItemName ?? null,
    gift_status: row.gift_status,
    gift_notes: row.gift_notes,
    gift_decision_reason: row.gift_decision_reason,
    gift_shop_order_id: row.gift_shop_order_id,
    gift_currency_transaction_id: row.gift_currency_transaction_id,
  };
}

// Shared by the per-attendee patch and bulk-propose endpoints so both validate identically.
export async function buildGiftProposalSet(opts: {
  giftKind: "gold" | "shop_item" | null;
  goldAmount?: number | null;
  shopItemId?: number | null;
  notes?: string | null;
  proposerId: string;
}): Promise<Partial<typeof eventAttendeeTable.$inferInsert>> {
  const now = new Date();

  if (opts.giftKind === null) {
    return {
      gift_kind: null,
      gift_gold_amount: null,
      gift_shop_item_id: null,
      gift_notes: null,
      gift_status: null,
      gift_proposed_by: null,
      gift_proposed_at: null,
      gift_decided_by: null,
      gift_decided_at: null,
      gift_decision_reason: null,
      updated_at: now,
    };
  }

  if (opts.giftKind === "gold") {
    const amount = opts.goldAmount ?? 0;
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000) { // max gold per gift
      throw createError({
        statusCode: 400,
        statusMessage: "Gold gift must be a whole number between 1 and 10000",
      });
    }
    return {
      gift_kind: "gold",
      gift_gold_amount: amount,
      gift_shop_item_id: null,
      gift_notes: opts.notes?.trim() || null,
      gift_status: "proposed",
      gift_proposed_by: opts.proposerId,
      gift_proposed_at: now,
      gift_decided_by: null,
      gift_decided_at: null,
      gift_decision_reason: null,
      updated_at: now,
    };
  }

  if (!opts.shopItemId) {
    throw createError({
      statusCode: 400,
      statusMessage: "A shop item is required for a shop item gift",
    });
  }
  const [item] = await db
    .select({
      id: shopItemTable.id,
      fulfillment_provider: shopItemTable.fulfillment_provider,
      coming_soon: shopItemTable.coming_soon,
    })
    .from(shopItemTable)
    .where(eq(shopItemTable.id, opts.shopItemId))
    .limit(1);
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }
  if (
    item.fulfillment_provider === "internal_synthetic" ||
    item.fulfillment_provider === "theseus"
  ) {
    throw createError({ statusCode: 400, statusMessage: "This item is not giftable" });
  }
  if (item.coming_soon === true) {
    throw createError({
      statusCode: 400,
      statusMessage: "This item is not available yet",
    });
  }
  return {
    gift_kind: "shop_item",
    gift_shop_item_id: item.id,
    gift_gold_amount: null,
    gift_notes: opts.notes?.trim() || null,
    gift_status: "proposed",
    gift_proposed_by: opts.proposerId,
    gift_proposed_at: now,
    gift_decided_by: null,
    gift_decided_at: null,
    gift_decision_reason: null,
    updated_at: now,
  };
}

export type ApproveGiftResult = {
  kind: "gold" | "shop_item";
  orderId?: number;
  transactionId?: number;
};

// Shop-item gifts write no ledger entry (free-grant rule). The conditional status claim
// makes a concurrent approve match nothing, so there's no double-credit.
export async function approveEventGift(opts: {
  attendeeId: number;
  actorId: string;
}): Promise<ApproveGiftResult> {
  const outcome = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(eventAttendeeTable)
      .set({
        gift_status: "approved",
        gift_decided_by: opts.actorId,
        gift_decided_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(eventAttendeeTable.id, opts.attendeeId),
          eq(eventAttendeeTable.gift_status, "proposed"),
        ),
      )
      .returning();
    if (!claimed) {
      throw createError({
        statusCode: 409,
        statusMessage: "Gift is not in a proposed state",
      });
    }

    const [event] = await tx
      .select({ title: eventTable.title })
      .from(eventTable)
      .where(eq(eventTable.id, claimed.event_id))
      .limit(1);
    const eventTitle = event?.title ?? `event #${claimed.event_id}`;

    if (claimed.gift_kind === "gold") {
      const amount = claimed.gift_gold_amount ?? 0;
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) { // max gold per gift
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid gift gold amount",
        });
      }
      const [txRow] = await tx
        .insert(currencyTransactionTable)
        .values({
          user_id: claimed.user_id,
          amount,
          type: "increase",
          source: "event_prize",
          fruit_type: null,
          memo: `Event prize: ${eventTitle}`,
          created_by_user_id: opts.actorId,
          counts: true,
          unlocked_at: new Date(),
        })
        .returning({ id: currencyTransactionTable.id });
      await tx
        .update(eventAttendeeTable)
        .set({ gift_currency_transaction_id: txRow?.id ?? null })
        .where(eq(eventAttendeeTable.id, claimed.id));
      return {
        recipientId: claimed.user_id,
        eventId: claimed.event_id,
        eventTitle,
        result: { kind: "gold" as const, transactionId: txRow?.id },
        description: `${amount} gold`,
      };
    }

    if (claimed.gift_kind === "shop_item") {
      if (!claimed.gift_shop_item_id) {
        throw createError({
          statusCode: 400,
          statusMessage: "Gift has no shop item set",
        });
      }
      const [item] = await tx
        .select()
        .from(shopItemTable)
        .where(eq(shopItemTable.id, claimed.gift_shop_item_id))
        .limit(1);
      if (!item) {
        throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
      }
      if (
        item.fulfillment_provider === "internal_synthetic" ||
        item.fulfillment_provider === "theseus"
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: "This item is not giftable",
        });
      }
      if (item.coming_soon === true) {
        throw createError({
          statusCode: 400,
          statusMessage: "This item is not available yet",
        });
      }
      // Conditional stock decrement for limited items (purchase-flow pattern).
      if (item.inventory_mode === "limited") {
        if (
          (
            await tx
              .update(shopItemTable)
              .set({
                stock_remaining: sql`${shopItemTable.stock_remaining} - 1`,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(shopItemTable.id, item.id),
                  eq(shopItemTable.inventory_mode, "limited"),
                  gte(shopItemTable.stock_remaining, 1),
                ),
              )
              .returning({ id: shopItemTable.id })
          ).length === 0
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: "This item does not have enough stock remaining",
          });
        }
      }
      const initialStatus =
        item.kind === "virtual_service"
          ? "service_activated"
          : item.fulfillment_provider === "hcb"
            ? "grant_pending"
            : "pending_internal_fulfillment";
      const [order] = await tx
        .insert(shopOrderTable)
        .values({
          user_id: claimed.user_id,
          item_id: item.id,
          quantity: 1,
          status: initialStatus,
          item_snapshot: buildShopItemSnapshot(item, null),
          selected_modifiers: null,
          shipping_address: null,
          region: null,
        })
        .returning({ id: shopOrderTable.id });
      await tx
        .update(eventAttendeeTable)
        .set({ gift_shop_order_id: order?.id ?? null })
        .where(eq(eventAttendeeTable.id, claimed.id));
      return {
        recipientId: claimed.user_id,
        eventId: claimed.event_id,
        eventTitle,
        result: { kind: "shop_item" as const, orderId: order?.id },
        description: item.name,
      };
    }

    throw createError({
      statusCode: 400,
      statusMessage: "Gift has no kind to approve",
    });
  });

  void notify({
    user_id: outcome.recipientId,
    type: "event_prize",
    title: "You received an event prize!",
    body: `You received ${outcome.description} for ${outcome.eventTitle}.`,
    action_url: `${publicBaseUrl()}/dashboard`,
    entity_type: "event",
    entity_id: String(outcome.eventId),
  });

  try {
    await writeAudit({
      actor_id: opts.actorId,
      action: "event_gift_approved",
      entity_type: "event_attendee",
      entity_id: String(opts.attendeeId),
      new_value: {
        event_id: outcome.eventId,
        recipient_id: outcome.recipientId,
        ...outcome.result,
        description: outcome.description,
      },
      sensitive: false,
      public_message: `Approved event gift (${outcome.description}) for ${outcome.eventTitle}`,
    });
  } catch (err) {
    console.error("[events] audit gift approve failed", err);
  }

  return outcome.result;
}

// The organizer may re-propose, which flips the row back to 'proposed'.
export async function denyEventGift(opts: {
  attendeeId: number;
  actorId: string;
  reason?: string;
}): Promise<void> {
  const [updated] = await db
    .update(eventAttendeeTable)
    .set({
      gift_status: "denied",
      gift_decided_by: opts.actorId,
      gift_decided_at: new Date(),
      gift_decision_reason: opts.reason ?? null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(eventAttendeeTable.id, opts.attendeeId),
        eq(eventAttendeeTable.gift_status, "proposed"),
      ),
    )
    .returning();
  if (!updated) {
    throw createError({
      statusCode: 409,
      statusMessage: "Gift is not in a proposed state",
    });
  }

  try {
    await writeAudit({
      actor_id: opts.actorId,
      action: "event_gift_denied",
      entity_type: "event_attendee",
      entity_id: String(opts.attendeeId),
      new_value: { event_id: updated.event_id, reason: opts.reason ?? null },
      sensitive: false,
      public_message: `Denied event gift on attendee #${opts.attendeeId}`,
    });
  } catch (err) {
    console.error("[events] audit gift deny failed", err);
  }
}
