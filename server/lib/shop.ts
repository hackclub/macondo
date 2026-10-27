import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { H3Event } from "h3";

import db from "../db";
import {
  currencyTransactionTable,
  shopItemTable,
  shopOrderTable,
  users,
} from "../db/schema";
import { writeAudit } from "./audit";
import { hcbGrantSpentCents } from "./hcb-grant-spend";
import type { HcbGrantTransactionSummary } from "./hcb-grant-spend";
import {
  createHcbClient,
  hcbGrantInfoCacheKey,
  invalidateHcbGrantInfoCache,
} from "./hcb";
import type { HcbCardGrant, HcbTransaction } from "./hcb";
import { setAccommodationCount } from "./loops";
import { isShopRegion } from "./regions";
import type { ShopRegion } from "./regions";
import { getRedis } from "./redis";
import { dm } from "./slack-bot";
import { THESEUS_API_URL } from "./api-urls";

export const GOLD_PER_HOUR = 10;

// must match the migrated shop_items row's slug
export const STREAK_FREEZE_SLUG = "streak_freeze";

export const EVENT_INVITE_SLUG = "event_invite";

export const PRE_ACCOMMODATION_SLUG = "pre_event_accommodation";
export const POST_ACCOMMODATION_SLUG = "post_event_accommodation";

// mirrored in app/utils/internalOrders.ts, which can't import server constants
export const TRAVEL_STIPEND_SLUG = "travel_stipend";

// Attendees finish their build at the event, so pending gold may fund getting there.
// Keep the copy in app/pages/shop.vue in sync.
const PENDING_GOLD_ELIGIBLE_SLUGS: ReadonlySet<string> = new Set([
  EVENT_INVITE_SLUG,
  TRAVEL_STIPEND_SLUG,
  PRE_ACCOMMODATION_SLUG,
  POST_ACCOMMODATION_SLUG,
]);

export function canPurchaseWithPendingGold(
  slug: string | null | undefined,
): boolean {
  return slug != null && PENDING_GOLD_ELIGIBLE_SLUGS.has(slug);
}

// Event items are always in: priority gold is earned by attendees to pay for the trip,
// so an unchecked flag would strand it.
export function canPurchaseWithPriorityGold(item: {
  slug: string | null;
  priority_eligible: boolean;
}): boolean {
  return item.priority_eligible === true || canPurchaseWithPendingGold(item.slug);
}

// No-op for non-accommodation slugs and never throws, so callers can fire it unconditionally.
export async function syncAccommodationCountToAirtable(
  userId: string,
  itemSlug: string | null | undefined,
): Promise<void> {
  const kind =
    itemSlug === PRE_ACCOMMODATION_SLUG
      ? ("pre" as const)
      : itemSlug === POST_ACCOMMODATION_SLUG
        ? ("post" as const)
        : null;
  if (!kind) return;

  try {
    const [buyer] = await db
      .select({ email: users.email, slack_id: users.slack_id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!buyer?.email) return;

    const [ownedRow] = await db
      .select({
        owned: sql<number>`COALESCE(SUM(${shopOrderTable.quantity}), 0)`.mapWith(Number),
      })
      .from(shopOrderTable)
      .innerJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
      .where(
        and(
          eq(shopOrderTable.user_id, userId),
          eq(shopItemTable.slug, itemSlug),
          notInArray(shopOrderTable.status, ["external_failure", "cancelled"]),
        ),
      );

    await setAccommodationCount({
      email: buyer.email,
      slack_id: buyer.slack_id,
      kind,
      count: Number(ownedRow?.owned ?? 0),
    });
  } catch {
    console.error("[shop] accommodation Airtable sync failed");
  }
}

// best-effort, never throws
export async function notifyOrganizersOfEventInvite(args: {
  buyerUsername: string | null;
  buyerSlackId: string | null;
  buyerId: string;
  orderId: number;
  itemName: string;
  quantity: number;
  autoQualified?: boolean;
}): Promise<void> {
  try {
    const config = useRuntimeConfig();
    const organizerIds = String(config.slackOrganizerIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (organizerIds.length === 0) return;

    const buyer = args.buyerSlackId
      ? `<@${args.buyerSlackId}>`
      : args.buyerUsername || args.buyerId;
    const qty = args.quantity > 1 ? `${args.quantity}x ` : "";
    const text = args.autoQualified
      ? `:tickets: *Event Invite auto-granted*\n` +
        `${buyer} hit the hours threshold and was granted ${qty}${args.itemName} ` +
        `(order #${args.orderId}). Reach out to arrange their invite.`
      : `:tickets: *Event Invite purchased*\n` +
        `${buyer} just bought ${qty}${args.itemName} (order #${args.orderId}). ` +
        `Reach out to arrange their invite.`;

    await Promise.all(
      organizerIds.map(async (user) => {
        const res = await dm({ user, text });
        if (!res.ok) {
          console.error(`[shop] organizer DM failed for ${user}:`, res.error);
        }
      }),
    );
  } catch (err) {
    console.error("[shop] notifyOrganizersOfEventInvite failed", err);
  }
}

export type ShopItemRow = InferSelectModel<typeof shopItemTable>;
export type ShopOrderRow = InferSelectModel<typeof shopOrderTable>;

export type ShopItemModifierOption = {
  id: string;
  label: string;
  label_translations?: Record<string, string>;
  price_delta_hours: number;
};

export type ShopItemModifier = {
  id: string;
  label: string;
  label_translations?: Record<string, string>;
  type: "single" | "multi" | "text";
  required?: boolean;
  // always [] (never absent) for text, so options.map call sites stay safe
  options: ShopItemModifierOption[];
  // text-only; max_length is clamped to TEXT_MODIFIER_HARD_CAP, the delta charged once
  max_length?: number;
  placeholder?: string;
  placeholder_translations?: Record<string, string>;
  price_delta_hours?: number;
};

export type SelectedModifierInput =
  | { modifier_id: string; option_id: string }
  | { modifier_id: string; option_ids: string[] }
  | { modifier_id: string; text: string };

// Frozen at purchase so later admin edits don't rewrite history. Text resolves to one option
// with id "text" and the text as its label, so existing renderers need no special casing.
export type ResolvedModifierSelection = {
  modifier_id: string;
  modifier_label: string;
  type: "single" | "multi" | "text";
  options: Array<{
    option_id: string;
    label: string;
    price_delta_hours: number;
  }>;
  text_value?: string;
};

// protects JSONB and memo size even if an admin writes a silly max_length to the DB
export const TEXT_MODIFIER_HARD_CAP = 200;
export const TEXT_MODIFIER_DEFAULT_MAX = 64;

const SHOP_CHECKOUT_ADDRESS_COOKIE = "shop_checkout_address";

export type ShopShippingAddress = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type ShopCheckoutAddressOption = {
  id: string;
  label: string;
  primary: boolean;
  shippingAddress: ShopShippingAddress;
  phone: string | null;
};

export type ShopItemSnapshot = {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  kind: ShopItemRow["kind"];
  fulfillment_provider: ShopItemRow["fulfillment_provider"];
  source: ShopItemRow["source"];
  price_hours: number;
  price_gold: number;
  // legacy fruit-pricing fields; new snapshots always emit null
  price_fruit_type: string | null;
  price_fruit_amount: number | null;
  price_fruit_level: number | null;
  price_fruit_category: "software" | "hardware" | null;
  grant_amount_cents: number | null;
  attachment_urls: string[];
  region: ShopRegion | null;
  // optional for pre-modifier orders; per-unit prices are base + deltas, clamped at 0
  modifiers_config?: ShopItemModifier[] | null;
  selected_modifiers?: ResolvedModifierSelection[];
  price_hours_per_unit?: number;
  price_gold_per_unit?: number;
};

export { hcbGrantSpentCents };
export type { HcbGrantTransactionSummary };

export type HcbGrantInfo = {
  id: string;
  amount_cents: number | null;
  balance_cents: number | null;
  spent_cents: number;
  purpose: string | null;
  status: string | null;
  returned: boolean;
  email: string | null;
  expires_on: string | null;
  card_id: string | null;
  transactions_total_count: number;
  transactions_has_more: boolean;
  transactions: HcbGrantTransactionSummary[];
  fetch_error: string | null;
};

export type ShopCheckoutAddress = {
  addresses: ShopCheckoutAddressOption[];
  shippingAddress: ShopShippingAddress;
  phone: string | null;
};

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeHcbGrantTransaction(
  transaction: HcbTransaction,
): HcbGrantTransactionSummary {
  return {
    id: String(transaction.id),
    date: trimString(transaction.date),
    amount_cents: normalizeNumber(transaction.amount_cents),
    memo: trimString(transaction.memo),
    pending: transaction.pending === true,
    declined: transaction.declined === true,
    reversed: transaction.reversed === true,
    missing_receipt: transaction.missing_receipt === true,
    code: trimString(transaction.code),
  };
}

function isReturnedHcbGrantStatus(status: string | null) {
  return status === "canceled" || status === "expired";
}

function normalizeHcbGrantInfo(
  grantId: string,
  grant: HcbCardGrant,
  transactions: HcbGrantTransactionSummary[],
  transactionsTotalCount: number,
  transactionsHasMore: boolean,
): HcbGrantInfo {
  const status = trimString(grant.status);

  return {
    id: grant.id ? String(grant.id) : grantId,
    amount_cents: normalizeNumber(grant.amount_cents),
    balance_cents: normalizeNumber(grant.balance_cents),
    spent_cents: hcbGrantSpentCents(transactions),
    purpose: trimString(grant.purpose),
    status,
    returned: isReturnedHcbGrantStatus(status),
    email: trimString(grant.email),
    expires_on: trimString(grant.expires_on),
    card_id: trimString(grant.card_id),
    transactions_total_count: transactionsTotalCount,
    transactions_has_more: transactionsHasMore,
    transactions,
    fetch_error: null,
  };
}

export function hcbGrantFetchErrorInfo(
  grantId: string,
  error: unknown,
): HcbGrantInfo {
  return {
    id: grantId,
    amount_cents: null,
    balance_cents: null,
    spent_cents: 0,
    purpose: null,
    status: null,
    returned: false,
    email: null,
    expires_on: null,
    card_id: null,
    transactions_total_count: 0,
    transactions_has_more: false,
    transactions: [],
    fetch_error:
      error instanceof Error && error.message.trim()
        ? error.message
        : "Failed to fetch HCB grant details",
  };
}

export function priceHoursToGold(priceHours: number): number {
  return priceHours * GOLD_PER_HOUR;
}

export function resolveRegularPriceHours(
  item: Pick<ShopItemRow, "kind" | "price_hours" | "regional_pricing">,
  region: ShopRegion | null,
): number {
  if (region == null || item.kind !== "physical") return item.price_hours;
  const override = item.regional_pricing?.[region];
  if (override && typeof override.price_hours === "number") {
    return override.price_hours;
  }
  return item.price_hours;
}

// a sale at or above the regular price counts as no sale, so stale overrides don't read as discounts
export function isItemOnSale(
  item: Pick<ShopItemRow, "kind" | "price_hours" | "regional_pricing" | "sale_price_hours">,
  region: ShopRegion | null = null,
): boolean {
  const sale = item.sale_price_hours;
  if (sale == null || !Number.isInteger(sale) || sale < 0) return false;
  return sale < resolveRegularPriceHours(item, region);
}

// single price chokepoint so display, snapshot and charge all agree
export function resolveItemPriceHours(
  item: Pick<ShopItemRow, "kind" | "price_hours" | "regional_pricing" | "sale_price_hours">,
  region: ShopRegion | null,
): number {
  const regular = resolveRegularPriceHours(item, region);
  const sale = item.sale_price_hours;
  if (sale != null && Number.isInteger(sale) && sale >= 0 && sale < regular) {
    return sale;
  }
  return regular;
}

// Grants are region-gated too (some countries can't redeem them), but only for availability,
// never price.
export function isItemAvailableInRegion(
  item: Pick<ShopItemRow, "kind" | "regional_pricing">,
  region: ShopRegion | null,
): boolean {
  if (region == null) return true;
  if (item.kind !== "physical" && item.kind !== "grant") return true;
  const override = item.regional_pricing?.[region];
  if (override && typeof override.available === "boolean") {
    return override.available;
  }
  return true;
}

export function goldToPriceHours(priceGold: number): number {
  return priceGold / GOLD_PER_HOUR;
}

// 0 is allowed so staff can mark free items without toggling `available` off
export function isValidGoldPrice(priceGold: number): boolean {
  return (
    Number.isInteger(priceGold) &&
    priceGold >= 0 &&
    priceGold % GOLD_PER_HOUR === 0
  );
}

export function normalizeAttachmentUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => trimString(entry))
    .filter((entry): entry is string => !!entry);
}

export function normalizeShippingAddress(
  value: unknown,
): ShopShippingAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const firstName = trimString(record.firstName);
  const lastName = trimString(record.lastName);
  const address1 = trimString(record.address1);
  const city = trimString(record.city);
  const state = trimString(record.state);
  const postalCode = trimString(record.postalCode);
  const country = trimString(record.country);

  if (
    !firstName ||
    !lastName ||
    !address1 ||
    !city ||
    !state ||
    !postalCode ||
    !country
  ) {
    return null;
  }

  return {
    firstName,
    lastName,
    address1,
    address2: trimString(record.address2),
    city,
    state,
    postalCode,
    country,
  };
}

function encodeShopCheckoutAddress(value: ShopCheckoutAddress) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function formatAddressLabel(address: ShopShippingAddress) {
  return [
    `${address.firstName} ${address.lastName}`.trim(),
    address.address1,
    address.address2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean).join(" - ");
}

function normalizeCheckoutAddressOption(
  value: unknown,
): ShopCheckoutAddressOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const shippingAddress = normalizeShippingAddress(record.shippingAddress);
  const id = trimString(record.id);

  if (!id || !shippingAddress) return null;

  return {
    id,
    label: trimString(record.label) ?? formatAddressLabel(shippingAddress),
    primary: record.primary === true,
    shippingAddress,
    phone: trimString(record.phone),
  };
}

export function getShopCheckoutAddress(
  event: H3Event,
): ShopCheckoutAddress | null {
  const rawValue = getCookie(event, SHOP_CHECKOUT_ADDRESS_COOKIE);
  if (!rawValue) return null;

  try {
    const parsedValue = JSON.parse(
      Buffer.from(rawValue, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const shippingAddress = normalizeShippingAddress(parsedValue.shippingAddress);
    const addresses = Array.isArray(parsedValue.addresses)
      ? parsedValue.addresses
        .map((entry) => normalizeCheckoutAddressOption(entry))
        .filter((entry): entry is ShopCheckoutAddressOption => !!entry)
      : [];

    if (!shippingAddress) return null;

    return {
      addresses: addresses.length
        ? addresses
        : [{
            id: "primary",
            label: formatAddressLabel(shippingAddress),
            primary: true,
            shippingAddress,
            phone: trimString(parsedValue.phone),
          }],
      shippingAddress,
      phone: trimString(parsedValue.phone),
    };
  } catch {
    return null;
  }
}

export function setShopCheckoutAddress(
  event: H3Event,
  value: ShopCheckoutAddress,
) {
  setCookie(event, SHOP_CHECKOUT_ADDRESS_COOKIE, encodeShopCheckoutAddress(value), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60, // checkout address cookie lifetime in seconds
  });
}

export function clearShopCheckoutAddress(event: H3Event) {
  deleteCookie(event, SHOP_CHECKOUT_ADDRESS_COOKIE, { path: "/" });
}

export function isShopItemExpired(
  item: Pick<ShopItemRow, "available_until">,
  now = new Date(),
): boolean {
  return item.available_until != null && item.available_until.getTime() <= now.getTime();
}

export function isShopItemSoldOut(
  item: Pick<ShopItemRow, "inventory_mode" | "stock_remaining">,
): boolean {
  return (
    item.inventory_mode === "limited" &&
    (item.stock_remaining ?? 0) <= 0
  );
}

export function isShopItemDisplayed(
  item: Pick<
    ShopItemRow,
    "available" | "available_until" | "inventory_mode" | "stock_remaining"
  >,
  now = new Date(),
): boolean {
  return item.available === true && !isShopItemExpired(item, now) && !isShopItemSoldOut(item);
}

export function isShopItemComingSoon(
  item: Pick<ShopItemRow, "coming_soon">,
): boolean {
  return item.coming_soon === true;
}

export function isShopItemPurchasable(
  item: Pick<
    ShopItemRow,
    "available" | "available_until" | "inventory_mode" | "stock_remaining" | "coming_soon"
  >,
  now = new Date(),
): boolean {
  return isShopItemDisplayed(item, now) && !isShopItemComingSoon(item);
}

export function isShopItemPurchasableInRegion(
  item: Pick<
    ShopItemRow,
    | "available"
    | "available_until"
    | "inventory_mode"
    | "stock_remaining"
    | "coming_soon"
    | "kind"
    | "regional_pricing"
  >,
  region: ShopRegion | null,
  now = new Date(),
): boolean {
  return isShopItemPurchasable(item, now) && isItemAvailableInRegion(item, region);
}

export function requiresCheckoutAddress(
  item:
    | Pick<ShopItemRow, "kind">
    | Pick<ShopItemSnapshot, "kind">,
): boolean {
  return item.kind === "physical" || item.kind === "grant";
}

// Only the stored config drives price math; the client never asserts deltas. The price is
// clamped at 0 in case an admin config has deltas that push it negative.
export function validateAndResolveSelectedModifiers(
  config: ShopItemModifier[] | null | undefined,
  input: SelectedModifierInput[] | undefined,
  basePriceHours: number,
): { resolved: ResolvedModifierSelection[]; priceHoursPerUnit: number } {
  const safeInput = Array.isArray(input) ? input : [];
  const safeConfig = Array.isArray(config) ? config : [];

  if (safeConfig.length === 0) {
    if (safeInput.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "This item does not accept modifier selections",
      });
    }
    return { resolved: [], priceHoursPerUnit: basePriceHours };
  }

  // reject duplicates so a client can't smuggle multiple entries for one modifier
  const inputByModifierId = new Map<string, SelectedModifierInput>();
  for (const entry of safeInput) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.modifier_id !== "string"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Each selectedModifiers entry must include a modifier_id",
      });
    }
    if (inputByModifierId.has(entry.modifier_id)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Duplicate modifier selection for "${entry.modifier_id}"`,
      });
    }
    inputByModifierId.set(entry.modifier_id, entry);
  }

  // catches forged ids and ids from a stale page load after an admin edit
  const configIds = new Set(safeConfig.map((mod) => mod.id));
  for (const id of inputByModifierId.keys()) {
    if (!configIds.has(id)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown modifier "${id}"`,
      });
    }
  }

  const resolved: ResolvedModifierSelection[] = [];
  let totalDeltaHours = 0;

  for (const modifier of safeConfig) {
    const optionsById = new Map(
      (modifier.options ?? []).map((opt) => [opt.id, opt]),
    );
    const inputEntry = inputByModifierId.get(modifier.id);

    if (modifier.type === "text") {
      if (inputEntry && ("option_id" in inputEntry || "option_ids" in inputEntry)) {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}" takes free text, not options`,
        });
      }
      const raw =
        inputEntry && "text" in inputEntry ? inputEntry.text : undefined;
      if (raw !== undefined && typeof raw !== "string") {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}" requires a text string`,
        });
      }
      // interior spacing is preserved because engraving spacing is intentional
      const sanitized = (raw ?? "")
        .replace(/\r\n|\r|\n/g, " ")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim();
      if (sanitized.length === 0) {
        if (modifier.required === true) {
          throw createError({
            statusCode: 400,
            statusMessage: `Enter text for "${modifier.label}"`,
          });
        }
        continue;
      }
      const maxLength = Math.min(
        modifier.max_length ?? TEXT_MODIFIER_DEFAULT_MAX,
        TEXT_MODIFIER_HARD_CAP,
      );
      if (sanitized.length > maxLength) {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}" must be ${maxLength} characters or fewer`,
        });
      }
      const delta = modifier.price_delta_hours ?? 0;
      resolved.push({
        modifier_id: modifier.id,
        modifier_label: modifier.label,
        type: "text",
        options: [
          {
            option_id: "text",
            label: sanitized,
            price_delta_hours: delta,
          },
        ],
        text_value: sanitized,
      });
      totalDeltaHours += delta;
    } else if (modifier.type === "single") {
      if (!inputEntry || !("option_id" in inputEntry)) {
        if (modifier.required === true) {
          throw createError({
            statusCode: 400,
            statusMessage: `Pick an option for "${modifier.label}"`,
          });
        }
        continue;
      }
      if (typeof inputEntry.option_id !== "string") {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}" requires a single option_id`,
        });
      }
      const option = optionsById.get(inputEntry.option_id);
      if (!option) {
        throw createError({
          statusCode: 400,
          statusMessage: `Unknown option for "${modifier.label}"`,
        });
      }
      resolved.push({
        modifier_id: modifier.id,
        modifier_label: modifier.label,
        type: "single",
        options: [
          {
            option_id: option.id,
            label: option.label,
            price_delta_hours: option.price_delta_hours,
          },
        ],
      });
      totalDeltaHours += option.price_delta_hours;
    } else {
      if (!inputEntry) continue;
      if (!("option_ids" in inputEntry)) {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}" requires option_ids (array)`,
        });
      }
      if (!Array.isArray(inputEntry.option_ids)) {
        throw createError({
          statusCode: 400,
          statusMessage: `"${modifier.label}".option_ids must be an array`,
        });
      }

      const seen = new Set<string>();
      const resolvedOptions: ResolvedModifierSelection["options"] = [];
      for (const optionId of inputEntry.option_ids) {
        if (typeof optionId !== "string") {
          throw createError({
            statusCode: 400,
            statusMessage: `"${modifier.label}".option_ids entries must be strings`,
          });
        }
        if (seen.has(optionId)) {
          throw createError({
            statusCode: 400,
            statusMessage: `Duplicate option "${optionId}" in "${modifier.label}"`,
          });
        }
        seen.add(optionId);
        const option = optionsById.get(optionId);
        if (!option) {
          throw createError({
            statusCode: 400,
            statusMessage: `Unknown option for "${modifier.label}"`,
          });
        }
        resolvedOptions.push({
          option_id: option.id,
          label: option.label,
          price_delta_hours: option.price_delta_hours,
        });
        totalDeltaHours += option.price_delta_hours;
      }
      // 0 picks is allowed; skip the empty entry to keep the snapshot compact
      if (resolvedOptions.length > 0) {
        resolved.push({
          modifier_id: modifier.id,
          modifier_label: modifier.label,
          type: "multi",
          options: resolvedOptions,
        });
      }
    }
  }

  return { resolved, priceHoursPerUnit: Math.max(0, basePriceHours + totalDeltaHours) };
}

export function buildShopItemSnapshot(
  item: ShopItemRow,
  region: ShopRegion | null = null,
  extras?: {
    resolvedModifiers?: ResolvedModifierSelection[];
    priceHoursPerUnit?: number;
  },
): ShopItemSnapshot {
  const basePriceHours = resolveItemPriceHours(item, region);
  const resolvedModifiers = extras?.resolvedModifiers ?? [];
  const priceHoursPerUnit =
    typeof extras?.priceHoursPerUnit === "number"
      ? extras.priceHoursPerUnit
      : basePriceHours;
  return {
    id: item.id,
    slug: item.slug ?? null,
    name: item.name,
    description: item.description ?? null,
    image_url: item.image_url ?? null,
    kind: item.kind,
    fulfillment_provider: item.fulfillment_provider,
    source: item.source ?? null,
    price_hours: basePriceHours,
    price_gold: priceHoursToGold(basePriceHours),
    price_fruit_type: null,
    price_fruit_amount: null,
    price_fruit_level: null,
    price_fruit_category: null,
    grant_amount_cents: item.grant_amount_cents ?? null,
    attachment_urls: item.attachment_urls ?? [],
    region,
    modifiers_config: item.modifiers ?? null,
    selected_modifiers: resolvedModifiers,
    price_hours_per_unit: priceHoursPerUnit,
    price_gold_per_unit: priceHoursToGold(priceHoursPerUnit),
  };
}

export function getOrderItemSnapshot(order: ShopOrderRow): ShopItemSnapshot | null {
  const snapshot = order.item_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const record = snapshot as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : 0;
  const slug = trimString(record.slug);
  const name = trimString(record.name);
  const kind =
    record.kind === "physical" ||
    record.kind === "grant" ||
    record.kind === "consumable" ||
    record.kind === "experience" ||
    record.kind === "virtual_service"
      ? record.kind
      : null;
  const fulfillmentProvider =
    record.fulfillment_provider === "internal" ||
    record.fulfillment_provider === "theseus" ||
    record.fulfillment_provider === "hcb" ||
    record.fulfillment_provider === "internal_synthetic"
      ? record.fulfillment_provider
      : null;
  const source: "hq" | "local" | null =
    record.source === "hq" || record.source === "local" ? record.source : null;
  const priceHours =
    typeof record.price_hours === "number" && Number.isInteger(record.price_hours)
      ? record.price_hours
      : 0;
  const priceGold =
    typeof record.price_gold === "number" && Number.isInteger(record.price_gold)
      ? record.price_gold
      : priceHoursToGold(priceHours);
  const grantAmountCents =
    typeof record.grant_amount_cents === "number" &&
    Number.isInteger(record.grant_amount_cents)
      ? record.grant_amount_cents
      : null;

  if (!id || !name || !kind || !fulfillmentProvider) {
    return null;
  }

  const regionField = trimString(record.region);

  // pre-modifier snapshots lack these, so default them for downstream total math
  const priceHoursPerUnit =
    typeof record.price_hours_per_unit === "number" &&
    Number.isFinite(record.price_hours_per_unit)
      ? record.price_hours_per_unit
      : priceHours;

  return {
    id,
    slug: slug ?? null,
    name,
    description: trimString(record.description),
    image_url: trimString(record.image_url),
    kind,
    fulfillment_provider: fulfillmentProvider,
    source,
    price_hours: priceHours,
    price_gold: priceGold,
    // legacy gold-priced orders predate these fields
    price_fruit_type: trimString(record.price_fruit_type),
    price_fruit_amount:
      typeof record.price_fruit_amount === "number" &&
      Number.isInteger(record.price_fruit_amount) &&
      record.price_fruit_amount > 0
        ? record.price_fruit_amount
        : null,
    price_fruit_level:
      typeof record.price_fruit_level === "number" &&
      Number.isInteger(record.price_fruit_level) &&
      record.price_fruit_level >= 1 &&
      record.price_fruit_level <= 4
        ? record.price_fruit_level
        : null,
    price_fruit_category:
      record.price_fruit_category === "software" ||
      record.price_fruit_category === "hardware"
        ? record.price_fruit_category
        : null,
    grant_amount_cents: grantAmountCents,
    attachment_urls: normalizeAttachmentUrls(record.attachment_urls),
    region: isShopRegion(regionField) ? regionField : null,
    modifiers_config: Array.isArray(record.modifiers_config)
      ? (record.modifiers_config as ShopItemModifier[])
      : null,
    selected_modifiers: Array.isArray(record.selected_modifiers)
      ? (record.selected_modifiers as ResolvedModifierSelection[])
      : [],
    price_hours_per_unit: priceHoursPerUnit,
    price_gold_per_unit:
      typeof record.price_gold_per_unit === "number" &&
      Number.isFinite(record.price_gold_per_unit)
        ? record.price_gold_per_unit
        : priceHoursToGold(priceHoursPerUnit),
  };
}

export function formatShopItemForResponse(
  item: ShopItemRow,
  region: ShopRegion | null = null,
  unlockState: { user_has_unlocked: boolean } | null = null,
) {
  const effectivePriceHours = resolveItemPriceHours(item, region);
  const regularPriceHours = resolveRegularPriceHours(item, region);
  const availableInRegion = isItemAvailableInRegion(item, region);
  return {
    ...item,
    attachment_urls: item.attachment_urls ?? [],
    grant_amount_cents: item.grant_amount_cents ?? null,
    coming_soon: item.coming_soon ?? false,
    price_hours: effectivePriceHours,
    price_gold: priceHoursToGold(effectivePriceHours),
    regular_price_hours: regularPriceHours,
    regular_price_gold: priceHoursToGold(regularPriceHours),
    is_on_sale: isItemOnSale(item, region),
    // stripped since the fruit-to-gold migration
    price_fruit_type: null,
    price_fruit_amount: null,
    price_fruit_level: null,
    price_fruit_category: null,
    is_expired: isShopItemExpired(item),
    is_sold_out: isShopItemSoldOut(item),
    is_purchasable: isShopItemPurchasable(item) && availableInRegion,
    available_in_region: availableInRegion,
    resolved_region: region,
    // null unlockState (anon viewer or admin list) reads as locked
    extra_fruity: item.extra_fruity === true,
    user_has_unlocked: unlockState?.user_has_unlocked ?? false,
  };
}

// compares via JSON so jsonb columns diff deeply
export function getChangedShopItemKeys(
  previousItem: ShopItemRow,
  nextItem: ShopItemRow,
): string[] {
  return [...new Set([...Object.keys(previousItem), ...Object.keys(nextItem)])].filter((key) => {
    if (["updated_at", "created_at"].includes(key)) return false;
    return JSON.stringify(previousItem[key as keyof ShopItemRow]) !== JSON.stringify(nextItem[key as keyof ShopItemRow]);
  });
}

export function getShopItemAuditMetadata(
  previousItem: ShopItemRow | null,
  nextItem: ShopItemRow,
) {
  if (!previousItem) {
    return {
      action: "create_shop_item",
      publicMessage: "Shop item created",
      changeSummary: nextItem.name,
    };
  }

  const meaningfulKeys = getChangedShopItemKeys(previousItem, nextItem);

  const availabilityArchived =
    meaningfulKeys.length === 1 &&
    meaningfulKeys[0] === "available" &&
    previousItem.available === true &&
    nextItem.available === false;

  const restocked =
    meaningfulKeys.length === 1 &&
    meaningfulKeys[0] === "stock_remaining" &&
    (nextItem.stock_remaining ?? 0) > (previousItem.stock_remaining ?? 0);

  const markedComingSoon =
    meaningfulKeys.length === 1 &&
    meaningfulKeys[0] === "coming_soon" &&
    previousItem.coming_soon !== true &&
    nextItem.coming_soon === true;

  const launchedFromComingSoon =
    meaningfulKeys.length === 1 &&
    meaningfulKeys[0] === "coming_soon" &&
    previousItem.coming_soon === true &&
    nextItem.coming_soon !== true;

  if (availabilityArchived) {
    return {
      action: "archive_shop_item",
      publicMessage: "Shop item archived",
      changeSummary: nextItem.name,
    };
  }

  if (restocked) {
    return {
      action: "restock_shop_item",
      publicMessage: "Shop item restocked",
      changeSummary: nextItem.name,
    };
  }

  if (markedComingSoon) {
    return {
      action: "hype_shop_item",
      publicMessage: "Shop item marked coming soon",
      changeSummary: nextItem.name,
    };
  }

  if (launchedFromComingSoon) {
    return {
      action: "launch_shop_item",
      publicMessage: "Shop item launched",
      changeSummary: nextItem.name,
    };
  }

  return {
    action: "update_shop_item",
    publicMessage: "Shop item updated",
    changeSummary: nextItem.name,
  };
}

export async function getShopOrderContext(orderId: number) {
  const [row] = await db
    .select({
      order: shopOrderTable,
      item: shopItemTable,
      orderUser: {
        id: users.id,
        name: users.name,
        email: users.email,
        hcb_email: users.hcb_email,
      },
    })
    .from(shopOrderTable)
    .leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
    .leftJoin(users, eq(shopOrderTable.user_id, users.id))
    .where(eq(shopOrderTable.id, orderId))
    .limit(1);

  return row ?? null;
}

export function formatShopOrderForResponse<
  TUser extends Record<string, unknown> | null,
>(
  row: {
    order: ShopOrderRow;
    item: ShopItemRow | null;
    orderUser: TUser;
  },
  options: {
    fulfillable?: boolean;
    includeShippingAddress?: boolean;
    includeFulfillmentError?: boolean;
  } = {},
) {
  const snapshot = row.item
    ? getOrderItemSnapshot(row.order) ?? buildShopItemSnapshot(row.item)
    : getOrderItemSnapshot(row.order);
  const canShowShippingAddress =
    options.includeShippingAddress === true &&
    snapshot?.kind === "physical" &&
    ["pending_internal_fulfillment", "external_failure"].includes(row.order.status);

  return {
    order: {
      ...row.order,
      // raw errors are internal diagnostics that confused students, so user-facing endpoints opt out
      fulfillment_error:
        options.includeFulfillmentError === false
          ? null
          : row.order.fulfillment_error,
      shipping_address: canShowShippingAddress
        ? normalizeShippingAddress(row.order.shipping_address)
        : null,
      phone: canShowShippingAddress
        ? row.order.phone
        : null,
      item_snapshot: snapshot,
      // legacy snapshots predate per-unit prices
      total_price_gold: snapshot
        ? (snapshot.price_gold_per_unit ?? snapshot.price_gold) * row.order.quantity
        : null,
    },
    item: row.item ? formatShopItemForResponse(row.item) : null,
    orderUser: row.orderUser,
    fulfillable: options.fulfillable ?? true,
  };
}

export async function createTheseusLetterForOrder(orderId: number) {
  const orderContext = await getShopOrderContext(orderId);
  if (!orderContext || !orderContext.item || !orderContext.orderUser) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const config = useRuntimeConfig();
  if (!config.theseusApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "Theseus API key not configured",
    });
  }

  const shippingAddress = normalizeShippingAddress(orderContext.order.shipping_address);
  if (!shippingAddress) {
    throw createError({
      statusCode: 400,
      statusMessage: "Order has no valid shipping address",
    });
  }

  const snapshot = getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item);

  const queueName =
    typeof config.theseusLetterQueue === "string" &&
    config.theseusLetterQueue.trim().length > 0
      ? config.theseusLetterQueue.trim()
      : "macondo";

  const theseusPayload = {
    address: {
      first_name: shippingAddress.firstName,
      last_name: shippingAddress.lastName,
      line_1: shippingAddress.address1,
      line_2: shippingAddress.address2 || null,
      city: shippingAddress.city,
      state: shippingAddress.state,
      postal_code: shippingAddress.postalCode,
      country: shippingAddress.country,
    },
    rubber_stamps: snapshot.name,
    recipient_email: orderContext.orderUser.email || undefined,
    idempotency_key: `macondo-order-${orderContext.order.id}`,
    metadata: { shop_order_id: orderContext.order.id },
  };

  const theseusResponse = await fetch(
    `${THESEUS_API_URL}/letter_queues/${queueName}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.theseusApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(theseusPayload),
    },
  );

  if (!theseusResponse.ok) {
    throw createError({
      statusCode: theseusResponse.status,
      statusMessage: `Theseus error: ${(await theseusResponse.text()) || "Unknown error"}`,
    });
  }

  const letter = (await theseusResponse.json()) as { id?: string };
  if (!letter.id) {
    throw createError({
      statusCode: 502,
      statusMessage: "Theseus response did not include a letter ID",
    });
  }

  return {
    letterId: letter.id,
    snapshot,
  };
}

// parked in fulfillment_error while an HCB grant is in flight so concurrent requests see it claimed
export const GRANT_CLAIM_MARKER = "__granting__";

// another request owns the order, so callers must NOT write a failure status
export function isClaimConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 409
  );
}

export async function createHcbGrantForOrder(orderId: number) {
  const orderContext = await getShopOrderContext(orderId);
  if (!orderContext || !orderContext.item || !orderContext.orderUser) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const config = useRuntimeConfig();
  if (!config.hcbOrganizationId) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB organization ID not configured",
    });
  }

  const snapshot = getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item);
  const recipientEmail =
    orderContext.orderUser.hcb_email ?? orderContext.orderUser.email ?? null;

  if (!recipientEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: "User does not have an email available for HCB grant delivery",
    });
  }

  if (!snapshot.grant_amount_cents || snapshot.grant_amount_cents <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Grant item is missing a valid grant amount",
    });
  }

  // one combined grant covers every unit on the order
  const orderQuantity = Math.max(1, orderContext.order.quantity ?? 1);
  const totalGrantAmountCents = snapshot.grant_amount_cents * orderQuantity;

  const purposeSuffix = " Purchase";
  const purpose = `${snapshot.name.trim().slice(0, 30 - purposeSuffix.length) || "Shop item"}${purposeSuffix}`; // keep the grant purpose within 30 chars
  const quantitySuffix = orderQuantity > 1 ? ` (x${orderQuantity})` : "";

  // Atomic claim before calling HCB so concurrent requests can't both mint a live card.
  // It lives here, not in a handler, so every caller is covered.
  const [claimed] = await db
    .update(shopOrderTable)
    .set({ fulfillment_error: GRANT_CLAIM_MARKER, updated_at: new Date() })
    .where(
      and(
        eq(shopOrderTable.id, orderId),
        isNull(shopOrderTable.external_reference),
        // external_failure lets an admin re-drive a failed grant
        inArray(shopOrderTable.status, ["grant_pending", "external_failure"]),
        sql`${shopOrderTable.fulfillment_error} IS DISTINCT FROM ${GRANT_CLAIM_MARKER}`,
      ),
    )
    .returning({ id: shopOrderTable.id });
  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "This grant is already being created or is no longer in a grantable state. Refresh and check the order.",
    });
  }

  const response = await createHcbClient().createOrganizationCardGrant(
    String(config.hcbOrganizationId),
    {
      amount_cents: totalGrantAmountCents,
      email: recipientEmail,
      purpose,
      invite_message: `Your ${snapshot.name}${quantitySuffix} shop purchase is ready. Use this card only for this item and upload your receipt after purchase. The card locks automatically after one transaction.`,
      sent_by_email: true,
      // locks the card after one authorization so it can't fund a second purchase
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

  return {
    grantId: String(grant.id),
    snapshot,
  };
}

export async function returnHcbGrantForOrder(orderId: number) {
  const orderContext = await getShopOrderContext(orderId);
  if (!orderContext || !orderContext.item) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const snapshot = getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item);
  if (!snapshot || snapshot.kind !== "grant" || snapshot.fulfillment_provider !== "hcb") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only HCB grant orders can return a card grant",
    });
  }

  if (!orderContext.order.external_reference) {
    throw createError({
      statusCode: 400,
      statusMessage: "This order does not have an HCB grant reference",
    });
  }

  const grantId = orderContext.order.external_reference;
  const hcbClient = createHcbClient();
  if (isReturnedHcbGrantStatus(trimString((await hcbClient.getCardGrant(grantId)).status))) {
    // canceled outside Macondo, so drop the stale "active" cache ourselves
    await invalidateHcbGrantInfoCache(grantId);
    return {
      grantId,
      snapshot,
    };
  }

  await hcbClient.cancelCardGrant(grantId);

  return {
    grantId,
    snapshot,
  };
}

export interface HcbGrantRefundEligibility {
  canRefund: boolean;
  amountCents: number | null;
  balanceCents: number | null;
  spentCents: number;
}

// Must run before any mutation. A cancelled grant always reads balance 0, so fall back to real
// merchant spend; throws 502 on unreadable state rather than guessing.
export async function decideHcbGrantRefundEligibility(
  grantId: string,
): Promise<HcbGrantRefundEligibility> {
  const hcbClient = createHcbClient();
  // balance_cents is only populated when explicitly expanded
  const [grant, transactionResponse] = await Promise.all([
    hcbClient.getCardGrant(grantId, "balance_cents"),
    hcbClient.listCardGrantTransactions(grantId, { limit: 100 }).catch((error) => {
      console.warn("[shop] could not list card grant transactions", grantId, error);
      return null;
    }),
  ]);

  const amountCents = grant.amount_cents ?? null;
  const balanceCents = grant.balance_cents ?? null;
  const spentCents = transactionResponse
    ? hcbGrantSpentCents(transactionResponse.data.map(normalizeHcbGrantTransaction))
    : 0;
  // A truncated page means we can't prove the card is unspent.
  const spendKnown = !!transactionResponse && !transactionResponse.has_more;
  const result = { amountCents, balanceCents, spentCents };

  if ((amountCents ?? 0) === 0) return { canRefund: true, ...result };
  if (balanceCents !== null && balanceCents === amountCents) {
    return { canRefund: true, ...result };
  }

  if (isReturnedHcbGrantStatus(trimString(grant.status))) {
    if (!spendKnown) {
      throw createError({
        statusCode: 502,
        statusMessage: `HCB grant ${grantId} is already canceled and its transactions are unreadable, so spend can't be confirmed. Retry, or refund manually after verifying the card.`,
      });
    }
    return { canRefund: spentCents === 0, ...result };
  }

  if (balanceCents === null) {
    throw createError({
      statusCode: 502,
      statusMessage: `HCB returned a grant with amount_cents=${amountCents} but no balance_cents; cannot decide refund. Retry, or refund manually.`,
    });
  }

  return { canRefund: false, ...result };
}

export interface ReturnHcbGrantAndRefundResult {
  orderId: number;
  grantId: string | null;
  revoked: boolean;
  refunded: boolean;
  refundAmount: number | null;
  refundFruitType: string | null;
  // revoked without a refund; needs manual reconciliation
  spent: boolean;
}

// For server-side clawbacks, which must never cancel a grant_created order and orphan a live card.
// A spent card is still revoked but without a refund (spent=true).
export async function returnHcbGrantAndRefund(
  orderId: number,
  actorId: string,
  opts?: { reasonLabel?: string },
): Promise<ReturnHcbGrantAndRefundResult> {
  const orderContext = await getShopOrderContext(orderId);
  if (!orderContext) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }
  const snapshot = orderContext.item
    ? getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item)
    : getOrderItemSnapshot(orderContext.order);
  if (!snapshot || snapshot.kind !== "grant" || snapshot.fulfillment_provider !== "hcb") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only HCB grant orders can return a card grant",
    });
  }
  if (!orderContext.order.external_reference) {
    throw createError({
      statusCode: 400,
      statusMessage: "This order does not have an HCB grant reference",
    });
  }

  // must be decided before revoking
  const { canRefund } = await decideHcbGrantRefundEligibility(
    orderContext.order.external_reference,
  );

  const { grantId } = await returnHcbGrantForOrder(orderId);

  let purchaseTx: { id: number; amount: number; fruit_type: string | null } | undefined;
  if (canRefund) {
    purchaseTx = (
      await db
        .select({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          fruit_type: currencyTransactionTable.fruit_type,
        })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.shop_order_id, orderId),
            eq(currencyTransactionTable.type, "decrease"),
            eq(currencyTransactionTable.source, "shop_purchase"),
          ),
        )
        .limit(1)
    )[0];
  }

  const label = opts?.reasonLabel ? ` (${opts.reasonLabel})` : "";
  const updatedOrder = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${orderContext.order.user_id})::bigint)`,
    );
    if (purchaseTx) {
      const [alreadyRefunded] = await tx
        .select({ id: currencyTransactionTable.id })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.shop_order_id, orderId),
            eq(currencyTransactionTable.source, "shop_refund"),
            eq(currencyTransactionTable.counts, true),
          ),
        )
        .limit(1);
      if (!alreadyRefunded) {
        await tx.insert(currencyTransactionTable).values({
          user_id: orderContext.order.user_id,
          amount: purchaseTx.amount,
          type: "increase",
          source: "shop_refund",
          shop_order_id: orderId,
          fruit_type: purchaseTx.fruit_type,
          memo: `Refund for returned HCB grant on order #${orderId}${label}`,
          counts: true,
          created_by_user_id: actorId,
        });
      }
    }
    const [row] = await tx
      .update(shopOrderTable)
      .set({ status: "grant_created", fulfillment_error: null, updated_at: new Date() })
      .where(eq(shopOrderTable.id, orderId))
      .returning();
    return row;
  });

  const refunded = !!purchaseTx;
  try {
    await writeAudit({
      actor_id: actorId,
      action: "return_shop_grant",
      entity_type: "shop_order",
      entity_id: String(orderId),
      old_value: orderContext.order,
      new_value: updatedOrder ?? null,
      sensitive: true,
      public_message: refunded
        ? "HCB grant returned and gold refunded"
        : "HCB grant returned",
      change_summary: `${snapshot.name} (${grantId})${label}`,
    });
  } catch (error) {
    console.error("[shop] failed to write audit for returnHcbGrantAndRefund", error);
  }

  return {
    orderId,
    grantId,
    revoked: true,
    refunded,
    refundAmount: purchaseTx ? purchaseTx.amount : null,
    refundFruitType: purchaseTx?.fruit_type ?? null,
    spent: !canRefund,
  };
}

export async function fetchHcbGrantInfoById(
  grantId: string,
): Promise<HcbGrantInfo> {
  const cacheKey = hcbGrantInfoCacheKey(grantId);

  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as HcbGrantInfo;
    } catch (err) {
      console.warn("[shop] hcb grant-info cache read failed", err);
    }
  }

  const hcbClient = createHcbClient();
  const [grant, transactionResponse] = await Promise.all([
    hcbClient.getCardGrant(grantId, "balance_cents"),
    hcbClient.listCardGrantTransactions(grantId, { limit: 25 }),
  ]);
  const info = normalizeHcbGrantInfo(
    grantId,
    grant,
    transactionResponse.data.map(normalizeHcbGrantTransaction),
    transactionResponse.total_count,
    transactionResponse.has_more,
  );

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(info), {
        EX: 300, // display-only, so a 5 minute ttl is fine
      });
    } catch (err) {
      console.warn("[shop] hcb grant-info cache write failed", err);
    }
  }

  return info;
}

export async function fetchHcbGrantInfoForOrder(
  order: ShopOrderRow,
): Promise<HcbGrantInfo | null> {
  const snapshot = getOrderItemSnapshot(order);
  if (
    !snapshot ||
    snapshot.kind !== "grant" ||
    snapshot.fulfillment_provider !== "hcb" ||
    !order.external_reference
  ) {
    return null;
  }

  return fetchHcbGrantInfoById(order.external_reference);
}
