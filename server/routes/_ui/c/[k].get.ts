// Rotating, unadvertised path to deter third-party scrapers. Rate limiting does the real work;
// the path and encoding are speed bumps, not a security boundary. Kept outside /api on purpose.

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import db from "../../../db";
import { assertFirstPartyRequest } from "../../../lib/first-party";
import { checkRateLimits } from "../../../lib/rate-limit";
import {
  mintObfSecret,
  resolvePathTokenBucket,
  secretMatches,
  verifyUiToken,
} from "../../../lib/ui-token";
import {
  shopItemStarTable,
  shopItemTable,
  shopItemUnlockTable,
  shopOrderTable,
} from "../../../db/schema";
import {
  formatShopItemForResponse,
  isShopItemDisplayed,
  STREAK_FREEZE_SLUG,
} from "../../../lib/shop";
import { getSession } from "../../../lib/session";
import { userHasShippedProject } from "../../../lib/ships";
import { translateShopItem } from "../../../lib/translate-shop";
import { resolveBrowsingRegion } from "../../../lib/shop-region";
import { isShopUnderRenovation } from "../../../lib/app-settings";
import {
  encodeCatalogPayload,
  obfBucket,
  OBF_BUCKET_GRACE,
} from "../../../../shared/utils/shop-obfuscation";

const SUPPORTED_LOCALES = new Set(["en", "es"]);

function resolveLocale(raw: string | undefined | null): string {
  if (!raw) return "en";
  const base = raw.split("-")[0]!.split("_")[0]!.toLowerCase();
  return SUPPORTED_LOCALES.has(base) ? base : "en";
}

// Caches anonymous viewers only: their payload depends just on locale and region.
const cachedCatalogHandler = defineCachedEventHandler(async (event) => {
  const cookieLocale = getCookie(event, "i18n_locale");
  const user = await getSession(event);
  const queryLocale = getQuery(event).locale;
  const locale = resolveLocale(
    (typeof queryLocale === "string" ? queryLocale : null) ||
      cookieLocale ||
      user?.locale ||
      "en",
  );

  const region = resolveBrowsingRegion(event, user);

  if (await isShopUnderRenovation()) {
    return {
      items: [],
      region,
      user_has_shipped_project: user ? await userHasShippedProject(user.id) : null,
      under_renovation: true,
    };
  }

  const items = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.available, true))
    .orderBy(desc(shopItemTable.pinned), shopItemTable.id);

  // null for anonymous viewers so the UI falls back to the regular log-in flow.
  const userShipped = user ? await userHasShippedProject(user.id) : null;

  // Must match the purchase endpoint's filter: everything except external_failure counts.
  const cappedItemIds = items
    .filter((it) => it.max_per_user != null)
    .map((it) => it.id);
  const purchasedByItem = new Map<number, number>();
  if (user && cappedItemIds.length > 0) {
    const ownedRows = await db
      .select({
        item_id: shopOrderTable.item_id,
        owned: sql<number>`COALESCE(SUM(${shopOrderTable.quantity}), 0)`.mapWith(Number),
      })
      .from(shopOrderTable)
      .where(
        and(
          eq(shopOrderTable.user_id, user.id),
          inArray(shopOrderTable.item_id, cappedItemIds),
          ne(shopOrderTable.status, "external_failure"),
        ),
      )
      .groupBy(shopOrderTable.item_id);
    for (const row of ownedRows) {
      purchasedByItem.set(row.item_id, Number(row.owned ?? 0));
    }
  }

  const starredItemIds = new Set<number>();
  if (user) {
    const rows = await db
      .select({ item_id: shopItemStarTable.item_id })
      .from(shopItemStarTable)
      .where(eq(shopItemStarTable.user_id, user.id));
    for (const r of rows) starredItemIds.add(r.item_id);
  }

  const unlockedItemIds = new Set<number>();
  if (user) {
    const rows = await db
      .select({ item_id: shopItemUnlockTable.item_id })
      .from(shopItemUnlockTable)
      .where(eq(shopItemUnlockTable.user_id, user.id));
    for (const r of rows) unlockedItemIds.add(r.item_id);
  }

  const displayedItems = items
    .filter((item) => isShopItemDisplayed(item))
    .map((item) => {
      const userHasUnlocked = user ? unlockedItemIds.has(item.id) : false;
      const base = formatShopItemForResponse(item, region, {
        user_has_unlocked: userHasUnlocked,
      });
      // Internal sourcing store_urls must not leak into this public, shared-cached catalog.
      const publicRegionalPricing = base.regional_pricing
        ? Object.fromEntries(
            Object.entries(base.regional_pricing).map(([key, value]) => {
              const { store_url: _storeUrl, ...rest } = value ?? {};
              return [key, rest];
            }),
          )
        : base.regional_pricing;
      const userPurchasedCount = purchasedByItem.get(item.id) ?? 0;
      const hitPerUserCap =
        item.max_per_user != null && userPurchasedCount >= item.max_per_user;
      // Anonymous viewers (null) aren't blocked, so they reach the log-in flow instead.
      const blockedNoShip =
        item.requires_shipped_project === true && userShipped === false;
      const lockedForViewer =
        item.extra_fruity === true && !userHasUnlocked;
      return {
        ...base,
        regional_pricing: publicRegionalPricing,
        user_purchased_count: userPurchasedCount,
        hit_per_user_cap: hitPerUserCap,
        requires_shipped_project: item.requires_shipped_project === true,
        blocked_no_shipped_project: blockedNoShip,
        is_locked: lockedForViewer,
        is_purchasable:
          base.is_purchasable && !hitPerUserCap && !blockedNoShip && !lockedForViewer,
        // Streak freezes are capped per user, so the buy modal hides its quantity selector.
        max_quantity_per_order: item.slug === STREAK_FREEZE_SLUG ? 1 : null,
        pinned: item.pinned === true,
        starred: starredItemIds.has(item.id),
      };
    });

  const orderedItems = [
    ...displayedItems.filter((item) => item.pinned === true),
    ...displayedItems.filter(
      (item) => item.pinned !== true && item.available_in_region !== false,
    ),
    ...displayedItems.filter(
      (item) => item.pinned !== true && item.available_in_region === false,
    ),
  ];

  if (locale === "en") {
    return {
      items: orderedItems,
      region,
      user_has_shipped_project: userShipped,
      under_renovation: false,
    };
  }

  const overridesByDbId = new Map<
    number,
    { name: Record<string, string> | null; description: Record<string, string> | null }
  >();
  for (const row of items) {
    overridesByDbId.set(row.id, {
      name: row.name_translations ?? null,
      description: row.description_translations ?? null,
    });
  }

  const translated = await Promise.all(
    orderedItems.map(async (item) => {
      const t = await translateShopItem(
        item.id,
        locale,
        item.name,
        item.description ?? null,
        "en",
        overridesByDbId.get(item.id),
      );
      return {
        ...item,
        name: t.name,
        description: t.description || item.description,
      };
    }),
  );

  return {
    items: translated,
    region,
    user_has_shipped_project: userShipped,
    under_renovation: false,
  };
}, {
  maxAge: 60,
  swr: true,
  // Nitro strips every header not named here from the cloned request; getKey owns
  // the cache key, so listing cookie doesn't fragment it.
  varies: ["cookie", "cf-ipcountry"],
  shouldBypassCache: (event) => !!getCookie(event, "macondo_session"),
  // Anonymous region comes from cf-ipcountry, so key on it directly.
  getKey: (event) => {
    const q = getQuery(event);
    const queryLocale = typeof q.locale === "string" ? q.locale : "";
    const cookieLocale = getCookie(event, "i18n_locale") ?? "";
    const cfCountry = getRequestHeader(event, "cf-ipcountry") ?? "";
    return `shop:items:${queryLocale}:${cookieLocale}:${cfCountry}`;
  },
});

// Not authentication. Must run before the cache wrapper or a warm SWR entry is served to anyone.
// x-mq-ssr is server-to-server (no browser headers); a lifted mq_ui cookie also needs same-origin headers.
function assertUiGate(event: H3Event): void {
  const secret = ((useRuntimeConfig().uiGateSecret as string) ?? "").trim();
  if (!secret) return;

  if (secretMatches(secret, getRequestHeader(event, "x-mq-ssr"))) return;

  if (verifyUiToken(secret, getCookie(event, "mq_ui"))) {
    assertFirstPartyRequest(event);
    return;
  }

  throw createError({ statusCode: 403, statusMessage: "Forbidden" });
}

const CATALOG_RATE_WINDOWS: Array<[limit: number, windowSeconds: number]> = [
  [15, 10],
  [60, 60],
  [400, 3600],
];

function rateLimitKey(event: H3Event): string {
  const session = getCookie(event, "macondo_session");
  if (session) return `s:${session.slice(0, 32)}`;
  const ip =
    getRequestHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ||
    getRequestHeader(event, "x-real-ip")?.trim() ||
    event.node?.req?.socket?.remoteAddress ||
    "unknown";
  return `i:${ip}`;
}

export default defineEventHandler(async (event) => {
  assertUiGate(event);

  const rate = await checkRateLimits(
    rateLimitKey(event),
    "ui-catalog",
    CATALOG_RATE_WINDOWS,
  );
  if (!rate.allowed) {
    setResponseHeader(event, "Retry-After", rate.retryAfterSeconds);
    throw createError({ statusCode: 429, statusMessage: "Too many requests" });
  }

  const secret = ((useRuntimeConfig().uiGateSecret as string) ?? "").trim();

  // dev without the secret: plain JSON on any path
  if (!secret) return cachedCatalogHandler(event);

  // Stale tokens 404 like unknown routes, so probing reveals nothing; clients re-key via /_ui/k.
  const bucket = resolvePathTokenBucket(
    secret,
    getRouterParam(event, "k"),
    obfBucket(Date.now()),
    OBF_BUCKET_GRACE,
  );
  if (bucket === null) {
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
  }

  const payload = await cachedCatalogHandler(event);

  // Use the caller's bucket, not the current one: a lagging client holds that key.
  return encodeCatalogPayload(
    mintObfSecret(secret, bucket),
    randomBytes(9).toString("base64url"), // 12-char nonce
    payload,
  );
});
