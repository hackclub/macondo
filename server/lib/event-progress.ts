// "Qualified" means holding a valid Event Invite, whether granted free or bought with gold.
// Free grants never touch the ledger, so an invite order with no purchase row was granted.

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import db from "../db";
import {
  certificatesTable,
  currencyTransactionTable,
  shipContributorsTable,
  shipTable,
  shopItemTable,
  shopOrderTable,
  users,
} from "../db/schema";
import { EVENT_QUALIFY_HOURS } from "./event-auto-qualify";
import {
  EVENT_INVITE_SLUG,
  priceHoursToGold,
  resolveItemPriceHours,
} from "./shop";

export const EVENT_SEAT_GOAL = 200; // seats to fill at the in-person event

// Mirrors the private constant in certificates.ts; keep in sync by hand.
const ORDER_STATUSES_NOT_PURCHASED: ("cancelled" | "external_failure")[] = [
  "cancelled",
  "external_failure",
];

// Submitted but not yet reviewer-decided; hackatime_hours is the upper bound on approval.
const PENDING_STATUSES: ("under_review" | "pending_fraud_review")[] = [
  "under_review",
  "pending_fraud_review",
];

const SHIPPED_STATUSES: ("shipped" | "shipped_missing_airtable")[] = [
  "shipped",
  "shipped_missing_airtable",
];

const EASTERN = "America/New_York";
const DAY_MS = 86_400_000;

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const at = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (
    Date.UTC(
      at("year"),
      at("month") - 1,
      at("day"),
      at("hour") % 24, // intl can report midnight as hour 24
      at("minute"),
      at("second"),
    ) - date.getTime()
  );
}

// DST-correct, so the deadline doesn't shift by an hour if these dates move.
export function easternInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ts = naive - zoneOffsetMs(new Date(naive), EASTERN);
  ts = naive - zoneOffsetMs(new Date(ts), EASTERN);
  return new Date(ts);
}

// Aug 9 is the last day to qualify, so the window shuts at 00:00 on the 10th.
export const QUALIFICATION_DEADLINE = easternInstant(2026, 8, 10, 0);
export const EVENT_START = easternInstant(2026, 8, 14, 12);

export const TREND_START = easternInstant(2026, 7, 8, 0);

export type DailyPoint = {
  day: string;
  qualified: number;
  cumulative: number;
};

export type BreakdownRow = {
  label: string;
  count: number;
};

export type HoursBand = {
  label: string;
  min: number;
  max: number | null;
  count: number;
};

// "unanswered" covers everyone who hasn't answered the popup (most users),
// so a small "yes" column is a coverage artefact, not a demand signal.
export type IntentKey = "yes" | "no" | "unanswered";

export const INTENT_KEYS: IntentKey[] = ["yes", "no", "unanswered"];

export type UnlockCandidate = {
  userId: string;
  name: string | null;
  username: string | null;
  email: string | null;
  approvedHours: number;
  pendingHours: number;
  projectedHours: number;
  intent: IntentKey;
};

const UNLOCK_LIST_LIMIT = 250; // cap on the named list, flagged when truncated

// Headcounts only; series and band arrays are left out on purpose.
export type IntentSlice = {
  intent: IntentKey;

  qualified: number;
  granted: number;
  bought: number;
  certificatesClaimed: number;
  countriesRepresented: number;

  atHoursBar: number;
  grantGap: number;

  makersWithWorkInReview: number;
  reviewBacklogHours: number;
  unlockedByReview: number;

  canAffordNow: number;
  reachableNow: number;
};

export type EventProgressResponse = {
  goal: number;
  qualifyHours: number;
  qualificationDeadline: string;
  eventStart: string;
  generatedAt: string;

  qualified: number;
  granted: number;
  bought: number;
  remainingToGoal: number;

  qualifiedLast24h: number;
  qualifiedLast7d: number;
  qualifiedPrev7d: number;

  daily: DailyPoint[];

  // Everyone at or over the hours bar, seat or not.
  atHoursBar: number;
  // Makers over the bar with no invite; should be zero after the auto-qualify sweep.
  grantGap: number;
  hoursBands: HoursBand[];

  // Submitted but undecided hours, taken at face value with no deflation modelling.
  makersWithWorkInReview: number;
  reviewBacklogHours: number;
  unlockedByReview: number;
  unlockedByReviewList: UnlockCandidate[];
  unlockedByReviewListTruncated: boolean;

  invitePriceGold: number | null;
  canAffordNow: number;
  affordBands: BreakdownRow[];
  reachableNow: number;

  // Always three entries in INTENT_KEYS order so the UI can render a fixed table.
  byIntent: IntentSlice[];

  certificatesClaimed: number;
  topCountries: BreakdownRow[];
  countriesRepresented: number;
};

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export async function buildEventProgress(
  now = new Date(),
): Promise<EventProgressResponse> {
  const intentRows = await db
    .select({
      userId: users.id,
      intent: users.event_attendance_intent,
    })
    .from(users)
    .where(isNotNull(users.event_attendance_intent));

  const intents = new Map<string, IntentKey>();
  for (const row of intentRows) {
    if (row.intent === "yes" || row.intent === "no") {
      intents.set(row.userId, row.intent);
    }
  }
  const intentOf = (userId: string): IntentKey =>
    intents.get(userId) ?? "unanswered";

  const emptySlice = (intent: IntentKey): IntentSlice => ({
    intent,
    qualified: 0,
    granted: 0,
    bought: 0,
    certificatesClaimed: 0,
    countriesRepresented: 0,
    atHoursBar: 0,
    grantGap: 0,
    makersWithWorkInReview: 0,
    reviewBacklogHours: 0,
    unlockedByReview: 0,
    canAffordNow: 0,
    reachableNow: 0,
  });
  const slices = new Map<IntentKey, IntentSlice>(
    INTENT_KEYS.map((k) => [k, emptySlice(k)]),
  );
  const slice = (userId: string): IntentSlice => slices.get(intentOf(userId))!;
  const countriesByIntent = new Map<IntentKey, Set<string>>(
    INTENT_KEYS.map((k) => [k, new Set<string>()]),
  );
  const reachableByIntent = new Map<IntentKey, Set<string>>(
    INTENT_KEYS.map((k) => [k, new Set<string>()]),
  );

  // A maker could hold two invites; dedupe below so capacity counts people, not orders.
  const inviteRows = await db
    .select({
      userId: shopOrderTable.user_id,
      createdAt: shopOrderTable.created_at,
      purchaseId: currencyTransactionTable.id,
      country: users.country,
    })
    .from(shopOrderTable)
    .innerJoin(shopItemTable, eq(shopItemTable.id, shopOrderTable.item_id))
    .innerJoin(users, eq(users.id, shopOrderTable.user_id))
    .leftJoin(
      currencyTransactionTable,
      eq(currencyTransactionTable.shop_order_id, shopOrderTable.id),
    )
    .where(
      and(
        eq(shopItemTable.slug, EVENT_INVITE_SLUG),
        notInArray(shopOrderTable.status, ORDER_STATUSES_NOT_PURCHASED),
      ),
    );

  type Holder = { at: number; paid: boolean; country: string | null };
  const holders = new Map<string, Holder>();
  for (const row of inviteRows) {
    const at = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    const existing = holders.get(row.userId);
    // Earliest invite wins: that is when the seat was actually secured.
    if (!existing || at < existing.at) {
      holders.set(row.userId, {
        at,
        paid: row.purchaseId != null,
        country: row.country,
      });
    }
  }

  const holderList = [...holders.values()];
  const qualified = holderList.length;
  const bought = holderList.filter((h) => h.paid).length;

  for (const [userId, holder] of holders) {
    const s = slice(userId);
    s.qualified += 1;
    if (holder.paid) s.bought += 1;
    else s.granted += 1;
    if (holder.country) countriesByIntent.get(intentOf(userId))!.add(holder.country);
  }

  const nowTs = now.getTime();
  const inWindow = (from: number, to: number) =>
    holderList.filter((h) => h.at > from && h.at <= to).length;

  // Seats won before TREND_START seed the baseline so the line doesn't start at zero.
  const firstDay = utcMidnight(TREND_START);
  const lastDay = utcMidnight(now);
  const perDay = new Map<string, number>();
  let baseline = 0;
  for (const h of holderList) {
    if (h.at < firstDay) {
      baseline += 1;
      continue;
    }
    const key = isoDay(h.at);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const daily: DailyPoint[] = [];
  let cumulative = baseline;
  for (let ts = firstDay; ts <= lastDay; ts += DAY_MS) {
    const day = isoDay(ts);
    const count = perDay.get(day) ?? 0;
    cumulative += count;
    daily.push({ day, qualified: count, cumulative });
  }

  // Pending reads each contributor's own hackatime_hours, so group hours land as they will at approval.
  const hoursRows = await db
    .select({
      userId: shipContributorsTable.user_id,
      approved: sql<number>`COALESCE(SUM(CASE WHEN ${shipTable.status} IN ('shipped', 'shipped_missing_airtable') THEN COALESCE(${shipContributorsTable.approved_hours}, 0) ELSE 0 END), 0)`,
      pending: sql<number>`COALESCE(SUM(CASE WHEN ${shipTable.status} IN ('under_review', 'pending_fraud_review') THEN COALESCE(${shipContributorsTable.hackatime_hours}, 0) ELSE 0 END), 0)`,
    })
    .from(shipContributorsTable)
    .innerJoin(shipTable, eq(shipTable.id, shipContributorsTable.ship_id))
    .where(inArray(shipTable.status, [...SHIPPED_STATUSES, ...PENDING_STATUSES]))
    .groupBy(shipContributorsTable.user_id);

  const bands: HoursBand[] = [
    { label: `${EVENT_QUALIFY_HOURS}+ hrs`, min: EVENT_QUALIFY_HOURS, max: null, count: 0 },
    { label: "40–49 hrs", min: 40, max: EVENT_QUALIFY_HOURS, count: 0 },
    { label: "25–39 hrs", min: 25, max: 40, count: 0 },
    { label: "10–24 hrs", min: 10, max: 25, count: 0 },
  ];

  let grantGap = 0;
  let atHoursBar = 0;
  let makersWithWorkInReview = 0;
  let reviewBacklogHours = 0;
  let unlockedByReview = 0;
  const unlockCandidates: { userId: string; approved: number; pending: number }[] = [];
  const seatlessAtBar = new Set<string>();
  for (const row of hoursRows) {
    const hours = Number(row.approved ?? 0);
    const pending = Number(row.pending ?? 0);
    const holdsInvite = holders.has(row.userId);
    const s = slice(row.userId);
    if (hours >= EVENT_QUALIFY_HOURS) {
      atHoursBar += 1;
      s.atHoursBar += 1;
      if (!holdsInvite) {
        grantGap += 1;
        s.grantGap += 1;
        seatlessAtBar.add(row.userId);
        reachableByIntent.get(intentOf(row.userId))!.add(row.userId);
      }
    }
    // Bands list who is still convertible, not an hours histogram.
    if (holdsInvite) continue;

    if (pending > 0) {
      makersWithWorkInReview += 1;
      reviewBacklogHours += pending;
      s.makersWithWorkInReview += 1;
      s.reviewBacklogHours += pending;
      if (hours < EVENT_QUALIFY_HOURS && hours + pending >= EVENT_QUALIFY_HOURS) {
        unlockedByReview += 1;
        s.unlockedByReview += 1;
        unlockCandidates.push({ userId: row.userId, approved: hours, pending });
      }
    }

    const band = bands.find(
      (b) => hours >= b.min && (b.max === null || hours < b.max),
    );
    if (band) band.count += 1;
  }

  // price_hours isn't gold; resolve sales first, then convert. Region is null since the invite isn't physical.
  const [inviteItem] = await db
    .select({
      kind: shopItemTable.kind,
      price_hours: shopItemTable.price_hours,
      sale_price_hours: shopItemTable.sale_price_hours,
      regional_pricing: shopItemTable.regional_pricing,
    })
    .from(shopItemTable)
    .where(eq(shopItemTable.slug, EVENT_INVITE_SLUG))
    .limit(1);
  const invitePriceGold = inviteItem
    ? priceHoursToGold(resolveItemPriceHours(inviteItem, null))
    : null;

  // Must match the balance logic in gold-adjust.ts and users/[id].get.ts.
  const balanceRows = await db
    .select({
      userId: currencyTransactionTable.user_id,
      balance: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`,
    })
    .from(currencyTransactionTable)
    .where(
      and(
        eq(currencyTransactionTable.counts, true),
        isNull(currencyTransactionTable.fruit_type),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    )
    .groupBy(currencyTransactionTable.user_id);

  // Ratio bands rather than raw gold so the shape survives a price change.
  const affordBands: BreakdownRow[] = [
    { label: "Can buy now", count: 0 },
    { label: "75–99% of price", count: 0 },
    { label: "50–74% of price", count: 0 },
    { label: "25–49% of price", count: 0 },
  ];
  let canAffordNow = 0;
  const affordersSeatless = new Set<string>();

  if (invitePriceGold && invitePriceGold > 0) {
    for (const row of balanceRows) {
      if (holders.has(row.userId)) continue;
      const ratio = Number(row.balance ?? 0) / invitePriceGold;
      if (ratio >= 1) {
        canAffordNow += 1;
        affordersSeatless.add(row.userId);
        slice(row.userId).canAffordNow += 1;
        reachableByIntent.get(intentOf(row.userId))!.add(row.userId);
        affordBands[0].count += 1;
      } else if (ratio >= 0.75) affordBands[1].count += 1;
      else if (ratio >= 0.5) affordBands[2].count += 1;
      else if (ratio >= 0.25) affordBands[3].count += 1;
    }
  }

  // Union, not sum: a maker at the bar who also has the gold counts once.
  const reachableNow = new Set([...seatlessAtBar, ...affordersSeatless]).size;

  // inArray with an empty list is invalid SQL in drizzle.
  const holderIds = [...holders.keys()];
  const certRows = holderIds.length
    ? await db
        .select({ userId: certificatesTable.user_id })
        .from(certificatesTable)
        .where(
          and(
            isNull(certificatesTable.revoked_at),
            inArray(certificatesTable.user_id, holderIds),
          ),
        )
    : [];
  for (const row of certRows) slice(row.userId).certificatesClaimed += 1;

  // Closest to the bar first, where review time converts a seat fastest.
  unlockCandidates.sort(
    (a, b) => b.approved + b.pending - (a.approved + a.pending),
  );
  const shortlist = unlockCandidates.slice(0, UNLOCK_LIST_LIMIT);
  const identityRows = shortlist.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          email: users.email,
        })
        .from(users)
        .where(
          inArray(
            users.id,
            shortlist.map((c) => c.userId),
          ),
        )
    : [];
  const identityById = new Map(identityRows.map((r) => [r.id, r]));
  const unlockedByReviewList: UnlockCandidate[] = shortlist.map((c) => {
    const who = identityById.get(c.userId);
    return {
      userId: c.userId,
      name: who?.name ?? null,
      username: who?.username ?? null,
      email: who?.email ?? null,
      approvedHours: Math.round(c.approved * 10) / 10,
      pendingHours: Math.round(c.pending * 10) / 10,
      projectedHours: Math.round((c.approved + c.pending) * 10) / 10,
      intent: intentOf(c.userId),
    };
  });

  const countryCounts = new Map<string, number>();
  for (const h of holderList) {
    if (!h.country) continue;
    countryCounts.set(h.country, (countryCounts.get(h.country) ?? 0) + 1);
  }

  for (const key of INTENT_KEYS) {
    const s = slices.get(key)!;
    s.countriesRepresented = countriesByIntent.get(key)!.size;
    s.reachableNow = reachableByIntent.get(key)!.size;
    s.reviewBacklogHours = Math.round(s.reviewBacklogHours);
  }

  return {
    goal: EVENT_SEAT_GOAL,
    qualifyHours: EVENT_QUALIFY_HOURS,
    qualificationDeadline: QUALIFICATION_DEADLINE.toISOString(),
    eventStart: EVENT_START.toISOString(),
    generatedAt: now.toISOString(),

    qualified,
    granted: qualified - bought,
    bought,
    remainingToGoal: Math.max(EVENT_SEAT_GOAL - qualified, 0),

    qualifiedLast24h: inWindow(nowTs - DAY_MS, nowTs),
    qualifiedLast7d: inWindow(nowTs - 7 * DAY_MS, nowTs),
    qualifiedPrev7d: inWindow(nowTs - 14 * DAY_MS, nowTs - 7 * DAY_MS),

    daily,

    atHoursBar,
    grantGap,
    hoursBands: bands,

    makersWithWorkInReview,
    reviewBacklogHours: Math.round(reviewBacklogHours),
    unlockedByReview,
    unlockedByReviewList,
    unlockedByReviewListTruncated: unlockCandidates.length > UNLOCK_LIST_LIMIT,

    invitePriceGold,
    canAffordNow,
    affordBands,
    reachableNow,

    byIntent: INTENT_KEYS.map((k) => slices.get(k)!),

    certificatesClaimed: certRows.length,
    topCountries: [...countryCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    countriesRepresented: countryCounts.size,
  };
}
