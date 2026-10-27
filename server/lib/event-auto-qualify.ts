// Free grants write NO currency_transactions row, so cancelling one refunds nothing. A reverted ship deliberately
// doesn't claw back the seat (clawback only reaches orders via shop_purchase rows); staff can cancel it.

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import db from "../db";
import {
  shipContributorsTable,
  shipTable,
  shopItemTable,
  shopOrderTable,
  users,
} from "../db/schema";
import { writeAudit } from "./audit";
import { countValidEventInvitePurchases, getCertifiableHours } from "./certificates";
import { addUserToEventChannel } from "./event-channel";
import { setEventQualifiedFlag } from "./loops";
import { notify } from "./notify";
import {
  buildShopItemSnapshot,
  EVENT_INVITE_SLUG,
  isShopItemPurchasable,
  notifyOrganizersOfEventInvite,
} from "./shop";

export const EVENT_QUALIFY_HOURS = 50;

export type AutoQualifyStatus =
  | "granted"
  | "already"
  | "below_threshold"
  | "not_verified"
  | "unavailable";

export type AutoQualifyResult = {
  status: AutoQualifyStatus;
  orderId?: number;
};

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export async function autoQualifyUserForEvent(
  userId: string,
  opts: { notifyOrganizers?: boolean } = {},
): Promise<AutoQualifyResult> {
  // Outside the lock: getCertifiableHours can't join a transaction anyway.
  const hours = await getCertifiableHours(userId);
  if (hours < EVENT_QUALIFY_HOURS) return { status: "below_threshold" };

  const outcome = await db.transaction(async (tx) => {
    // Same lock key as purchase, certificate claim and order cancel, so a grant can't race them.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`,
    );

    if ((await countValidEventInvitePurchases(userId, {}, tx)) > 0) {
      return { status: "already" as const };
    }

    // Same verified-identity requirement as purchases; unverified makers are picked up by a later sweep.
    const [person] = await tx
      .select({
        status: users.hca_verification_status,
        username: users.username,
        slack_id: users.slack_id,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (person?.status !== "verified") return { status: "not_verified" as const };

    const [item] = await tx
      .select()
      .from(shopItemTable)
      .where(eq(shopItemTable.slug, EVENT_INVITE_SLUG))
      .limit(1);
    if (!item || !isShopItemPurchasable(item)) {
      return { status: "unavailable" as const };
    }

    if (item.inventory_mode === "limited") {
      const restock = await tx
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
        .returning({ id: shopItemTable.id });
      if (restock.length === 0) return { status: "unavailable" as const };
    }

    // Same status the purchase path assigns, so a granted seat renders like a bought one.
    const [order] = await tx
      .insert(shopOrderTable)
      .values({
        user_id: userId,
        item_id: item.id,
        quantity: 1,
        status: "pending_internal_fulfillment",
        item_snapshot: buildShopItemSnapshot(item, null),
        selected_modifiers: null,
        shipping_address: null,
        region: null,
      })
      .returning({ id: shopOrderTable.id });

    return {
      status: "granted" as const,
      orderId: order!.id,
      itemName: item.name,
      username: person.username ?? null,
      slackId: person.slack_id ?? null,
      email: person.email ?? null,
    };
  });

  if (outcome.status !== "granted") return { status: outcome.status };

  // actor_id is NOT NULL, so use the maker's own id (the system-write convention).
  try {
    await writeAudit({
      actor_id: userId,
      action: "event_auto_qualify_granted",
      entity_type: "shop_order",
      entity_id: String(outcome.orderId),
      new_value: { hours, threshold: EVENT_QUALIFY_HOURS },
      public_message: `Reached ${hours}h of approved work and earned an Event Invite.`,
    });
  } catch (err) {
    console.error("[event-auto-qualify] audit write failed", userId, err);
  }

  // Before the DM so "you've been added" is usually already true when it lands.
  void addUserToEventChannel(userId);

  if (outcome.email) {
    void setEventQualifiedFlag({
      email: outcome.email,
      slack_id: outcome.slackId,
      qualified: true,
    });
  }

  const attendeeChannelId =
    (useRuntimeConfig().slackEventAttendeeChannelId as string | undefined) || "";
  void notify({
    user_id: userId,
    type: "event_prize",
    title: "You qualified for the event!",
    body:
      `You have ${hours} approved hours, so your Event Invite is on us. ` +
      `Attend the event and your certificate of completion unlocks once we confirm you were there.`,
    action_url: `${publicBaseUrl()}/event`,
    entity_type: "shop_order",
    entity_id: String(outcome.orderId),
    email: { template: "event_qualified", data: { hours } },
    slack: {
      text:
        `You qualified for the Macondo event! You have ${hours} approved hours, so your Event Invite is on us. ` +
        (attendeeChannelId
          ? `You've been added to <#${attendeeChannelId}>, keep an eye on it for updates. `
          : "") +
        `Attend the event and your certificate of completion unlocks once we confirm you were there: ${publicBaseUrl()}/certificate`,
    },
  });

  // The sweep suppresses this to avoid one organizer DM per user.
  if (opts.notifyOrganizers !== false) {
    void notifyOrganizersOfEventInvite({
      buyerUsername: outcome.username,
      buyerSlackId: outcome.slackId,
      buyerId: userId,
      orderId: outcome.orderId,
      itemName: outcome.itemName,
      quantity: 1,
      autoQualified: true,
    });
  }

  return { status: "granted", orderId: outcome.orderId };
}

export type AutoQualifySweepReport = {
  dryRun: boolean;
  threshold: number;
  candidates: number;
  userIds: string[];
  results: Record<AutoQualifyStatus, number>;
};

export async function runEventAutoQualifySweep(
  opts: { dryRun?: boolean } = {},
): Promise<AutoQualifySweepReport> {
  const dryRun = opts.dryRun === true;

  const rows = await db
    .select({ user_id: shipContributorsTable.user_id })
    .from(shipContributorsTable)
    .innerJoin(shipTable, eq(shipTable.id, shipContributorsTable.ship_id))
    .innerJoin(users, eq(users.id, shipContributorsTable.user_id))
    .where(
      and(
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        eq(users.hca_verification_status, "verified"),
        sql`NOT EXISTS (
          SELECT 1
          FROM ${shopOrderTable} AS so
          JOIN ${shopItemTable} AS si ON si.id = so.item_id
          WHERE so.user_id = ${shipContributorsTable.user_id}
            AND si.slug = ${EVENT_INVITE_SLUG}
            AND so.status NOT IN ('cancelled', 'external_failure')
        )`,
      ),
    )
    .groupBy(shipContributorsTable.user_id)
    .having(
      sql`COALESCE(SUM(COALESCE(${shipContributorsTable.approved_hours}, 0)), 0) >= ${EVENT_QUALIFY_HOURS}`,
    );

  const userIds = rows.map((r) => r.user_id);
  const results: Record<AutoQualifyStatus, number> = {
    granted: 0,
    already: 0,
    below_threshold: 0,
    not_verified: 0,
    unavailable: 0,
  };

  if (!dryRun) {
    for (const userId of userIds) {
      try {
        const res = await autoQualifyUserForEvent(userId, {
          notifyOrganizers: false,
        });
        results[res.status] += 1;
      } catch (err) {
        console.error("[event-auto-qualify] sweep grant failed", userId, err);
      }
    }
  }

  return {
    dryRun,
    threshold: EVENT_QUALIFY_HOURS,
    candidates: userIds.length,
    userIds,
    results,
  };
}
