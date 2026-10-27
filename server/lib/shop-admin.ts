import { and, ilike, inArray, isNull, or } from "drizzle-orm";

import db from "../db";
import { shopItemRequestTable } from "../db/schema";

import type { ShopItemModifier, ShopItemRow } from "./shop";
import {
  goldToPriceHours,
  isValidGoldPrice,
  normalizeAttachmentUrls,
  TEXT_MODIFIER_DEFAULT_MAX,
  TEXT_MODIFIER_HARD_CAP,
} from "./shop";
import { SHOP_REGIONS, type ShopRegion } from "./regions";

// Admins enter price deltas in gold (10 gold = $1); they're stored as hours.
type ModifierOptionInput = {
  id?: unknown;
  label?: unknown;
  labelTranslations?: unknown;
  priceDeltaGold?: unknown;
};

type ModifierInput = {
  id?: unknown;
  label?: unknown;
  labelTranslations?: unknown;
  type?: unknown;
  required?: unknown;
  options?: unknown;
  maxLength?: unknown;
  placeholder?: unknown;
  placeholderTranslations?: unknown;
  priceDeltaGold?: unknown;
};

const MODIFIER_ID_REGEX = /^[a-z0-9_-]{1,64}$/;
const MAX_OPTIONS_PER_MODIFIER = 20;
const MAX_OPTIONS_PER_ITEM = 100;
const MAX_MODIFIER_DELTA_GOLD = 1_000_000;

function normalizeOptionalLabelTranslations(
  value: unknown,
  fieldLabel: string,
): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be an object keyed by locale`,
    });
  }
  const out: Record<string, string> = {};
  for (const [locale, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SUPPORTED_TRANSLATION_LOCALES.includes(locale as SupportedTranslationLocale)) continue;
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string") {
      throw createError({
        statusCode: 400,
        statusMessage: `${fieldLabel}.${locale} must be a string`,
      });
    }
    const trimmed = raw.trim();
    if (trimmed) out[locale] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeModifiers(value: unknown): ShopItemModifier[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: "modifiers must be an array",
    });
  }
  if (value.length === 0) return null;

  const seenModifierIds = new Set<string>();
  let totalOptions = 0;
  const out: ShopItemModifier[] = [];

  for (const rawModifier of value as ModifierInput[]) {
    if (!rawModifier || typeof rawModifier !== "object" || Array.isArray(rawModifier)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Each modifier must be an object",
      });
    }

    if (typeof rawModifier.id !== "string" || !MODIFIER_ID_REGEX.test(rawModifier.id)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Modifier id must be lowercase letters, numbers, underscore or dash (1 to 64 chars)",
      });
    }
    if (seenModifierIds.has(rawModifier.id)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Duplicate modifier id "${rawModifier.id}"`,
      });
    }
    seenModifierIds.add(rawModifier.id);

    const label =
      typeof rawModifier.label === "string" ? rawModifier.label.trim() : "";
    if (!label) {
      throw createError({
        statusCode: 400,
        statusMessage: `Modifier "${rawModifier.id}" needs a label`,
      });
    }

    if (
      rawModifier.type !== "single" &&
      rawModifier.type !== "multi" &&
      rawModifier.type !== "text"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: `Modifier "${rawModifier.id}".type must be "single", "multi" or "text"`,
      });
    }
    const type = rawModifier.type;

    const required =
      (type === "single" || type === "text") && rawModifier.required === true
        ? true
        : false;

    if (type === "text") {
      // Free-text entry (e.g. engraving): no options, just text knobs and a flat price delta.
      const maxLengthRaw = rawModifier.maxLength ?? TEXT_MODIFIER_DEFAULT_MAX;
      if (
        typeof maxLengthRaw !== "number" ||
        !Number.isInteger(maxLengthRaw) ||
        maxLengthRaw < 1 ||
        maxLengthRaw > TEXT_MODIFIER_HARD_CAP
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `Modifier "${rawModifier.id}".maxLength must be an integer between 1 and ${TEXT_MODIFIER_HARD_CAP}`,
        });
      }

      let placeholder: string | undefined;
      if (rawModifier.placeholder != null) {
        if (typeof rawModifier.placeholder !== "string") {
          throw createError({
            statusCode: 400,
            statusMessage: `Modifier "${rawModifier.id}".placeholder must be a string`,
          });
        }
        placeholder = rawModifier.placeholder.trim().slice(0, 120) || undefined; // cap placeholder length
      }

      const priceDeltaGoldRaw = rawModifier.priceDeltaGold ?? 0;
      if (
        typeof priceDeltaGoldRaw !== "number" ||
        !Number.isInteger(priceDeltaGoldRaw) ||
        priceDeltaGoldRaw % 10 !== 0 ||
        Math.abs(priceDeltaGoldRaw) > MAX_MODIFIER_DELTA_GOLD
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `Modifier "${rawModifier.id}".priceDeltaGold must be a multiple of 10 within +/- ${MAX_MODIFIER_DELTA_GOLD}`,
        });
      }

      out.push({
        id: rawModifier.id,
        label,
        label_translations: normalizeOptionalLabelTranslations(
          rawModifier.labelTranslations,
          `Modifier "${rawModifier.id}".labelTranslations`,
        ),
        type,
        required,
        // Always [] so every options.map call site stays safe.
        options: [],
        max_length: maxLengthRaw,
        placeholder,
        placeholder_translations: normalizeOptionalLabelTranslations(
          rawModifier.placeholderTranslations,
          `Modifier "${rawModifier.id}".placeholderTranslations`,
        ),
        price_delta_hours: goldToPriceHours(priceDeltaGoldRaw),
      });
      continue;
    }

    if (!Array.isArray(rawModifier.options) || rawModifier.options.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Modifier "${rawModifier.id}" needs at least one option`,
      });
    }
    if (rawModifier.options.length > MAX_OPTIONS_PER_MODIFIER) {
      throw createError({
        statusCode: 400,
        statusMessage: `Modifier "${rawModifier.id}" cannot have more than ${MAX_OPTIONS_PER_MODIFIER} options`,
      });
    }

    const seenOptionIds = new Set<string>();
    const cleanedOptions = (rawModifier.options as ModifierOptionInput[]).map(
      (rawOption) => {
        if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
          throw createError({
            statusCode: 400,
            statusMessage: `Each option in "${rawModifier.id}" must be an object`,
          });
        }
        if (
          typeof rawOption.id !== "string" ||
          !MODIFIER_ID_REGEX.test(rawOption.id)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `Option id under "${rawModifier.id}" must match the slug rules`,
          });
        }
        if (seenOptionIds.has(rawOption.id)) {
          throw createError({
            statusCode: 400,
            statusMessage: `Duplicate option id "${rawOption.id}" in "${rawModifier.id}"`,
          });
        }
        seenOptionIds.add(rawOption.id);

        const optLabel =
          typeof rawOption.label === "string" ? rawOption.label.trim() : "";
        if (!optLabel) {
          throw createError({
            statusCode: 400,
            statusMessage: `Option "${rawOption.id}" in "${rawModifier.id}" needs a label`,
          });
        }

        const priceDeltaGoldRaw = rawOption.priceDeltaGold ?? 0;
        if (
          typeof priceDeltaGoldRaw !== "number" ||
          !Number.isInteger(priceDeltaGoldRaw) ||
          priceDeltaGoldRaw % 10 !== 0 ||
          Math.abs(priceDeltaGoldRaw) > MAX_MODIFIER_DELTA_GOLD
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `Option "${rawOption.id}" priceDeltaGold must be a multiple of 10 within +/- ${MAX_MODIFIER_DELTA_GOLD}`,
          });
        }

        return {
          id: rawOption.id,
          label: optLabel,
          label_translations: normalizeOptionalLabelTranslations(
            rawOption.labelTranslations,
            `Option "${rawOption.id}".labelTranslations`,
          ),
          price_delta_hours: goldToPriceHours(priceDeltaGoldRaw),
        };
      },
    );

    totalOptions += cleanedOptions.length;
    if (totalOptions > MAX_OPTIONS_PER_ITEM) {
      throw createError({
        statusCode: 400,
        statusMessage: `Item cannot have more than ${MAX_OPTIONS_PER_ITEM} options across all modifiers`,
      });
    }

    out.push({
      id: rawModifier.id,
      label,
      label_translations: normalizeOptionalLabelTranslations(
        rawModifier.labelTranslations,
        `Modifier "${rawModifier.id}".labelTranslations`,
      ),
      type,
      required,
      options: cleanedOptions,
    });
  }

  return out.length > 0 ? out : null;
}

export type RegionalPricingInput = Partial<
  Record<ShopRegion, { priceGold?: number | null; available?: boolean; storeUrl?: string | null }>
>;

type StoredRegionalPricing = Partial<
  Record<ShopRegion, { price_hours?: number; available?: boolean; store_url?: string }>
>;

function normalizeRegionalPricing(
  value: unknown,
): StoredRegionalPricing | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: "regionalPricing must be an object keyed by region code",
    });
  }

  const out: StoredRegionalPricing = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(SHOP_REGIONS as readonly string[]).includes(key)) continue;
    if (raw == null) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw createError({
        statusCode: 400,
        statusMessage: `regionalPricing.${key} must be an object`,
      });
    }

    const record = raw as Record<string, unknown>;
    const entry: { price_hours?: number; available?: boolean; store_url?: string } = {};

    if (record.priceGold != null) {
      if (typeof record.priceGold !== "number" || !isValidGoldPrice(record.priceGold)) {
        throw createError({
          statusCode: 400,
          statusMessage: `regionalPricing.${key}.priceGold must be a non-negative multiple of 10`,
        });
      }
      entry.price_hours = goldToPriceHours(record.priceGold);
    }

    if (record.available != null) {
      if (typeof record.available !== "boolean") {
        throw createError({
          statusCode: 400,
          statusMessage: `regionalPricing.${key}.available must be true or false`,
        });
      }
      entry.available = record.available;
    }

    if (record.storeUrl != null && record.storeUrl !== "") {
      if (typeof record.storeUrl !== "string") {
        throw createError({
          statusCode: 400,
          statusMessage: `regionalPricing.${key}.storeUrl must be a URL string`,
        });
      }
      const trimmed = record.storeUrl.trim();
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: `regionalPricing.${key}.storeUrl must be a valid URL (e.g. https://example.com)`,
        });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw createError({
          statusCode: 400,
          statusMessage: `regionalPricing.${key}.storeUrl must use http:// or https://`,
        });
      }
      entry.store_url = trimmed;
    }

    if (entry.price_hours !== undefined && !entry.store_url) {
      throw createError({
        statusCode: 400,
        statusMessage: `regionalPricing.${key} requires a store URL when a price override is set`,
      });
    }

    if (
      entry.price_hours !== undefined ||
      entry.available !== undefined ||
      entry.store_url !== undefined
    ) {
      out[key as ShopRegion] = entry;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

type ShopItemWriteBody = {
  name?: string;
  description?: string | null;
  nameTranslations?: Record<string, string | null> | null;
  descriptionTranslations?: Record<string, string | null> | null;
  imageUrl?: string | null;
  kind?: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
  fulfillmentProvider?: "internal" | "theseus" | "hcb" | "internal_synthetic";
  source?: "hq" | "local" | null;
  priceGold?: number;
  salePriceGold?: number | null;
  grantAmountDollars?: number | null;
  attachmentUrls?: string[];
  inventoryMode?: "unlimited" | "limited";
  stockRemaining?: number | null;
  maxPerUser?: number | null;
  availableUntil?: string | null;
  available?: boolean;
  comingSoon?: boolean;
  requiresShippedProject?: boolean;
  // Forces the item to the top of the grid, ignoring the viewer's filter and sort.
  pinned?: boolean;
  extraFruity?: boolean;
  // Priority-payout gold (event attendees) can only buy items with this on.
  priorityEligible?: boolean;
  // Validated against the mirror of app/data/shopCategories.ts; null or "" clears it.
  category?: string | null;
  regionalPricing?: RegionalPricingInput | null;
  // Deltas are entered in gold (multiples of 10) and stored as price_delta_hours; null or [] clears.
  modifiers?: Array<{
    id: string;
    label: string;
    labelTranslations?: Record<string, string> | null;
    type: "single" | "multi";
    required?: boolean;
    options: Array<{
      id: string;
      label: string;
      labelTranslations?: Record<string, string> | null;
      priceDeltaGold?: number;
    }>;
  }> | null;
};

const SUPPORTED_TRANSLATION_LOCALES = ["en", "es"] as const;
type SupportedTranslationLocale = (typeof SUPPORTED_TRANSLATION_LOCALES)[number];

function normalizeTranslations(
  value: unknown,
  fieldName: string,
): Record<string, string> | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be an object keyed by locale`,
    });
  }

  const out: Record<string, string> = {};
  for (const [locale, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SUPPORTED_TRANSLATION_LOCALES.includes(locale as SupportedTranslationLocale)) {
      continue;
    }
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string") {
      throw createError({
        statusCode: 400,
        statusMessage: `${fieldName}.${locale} must be a string`,
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length > 0) out[locale] = trimmed;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function hasOwn(body: object, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function trimNullableText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Expected text value",
    });
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGrantAmountCents(value: unknown): number | null {
  if (value == null || value === "") return null;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Grant amount must be a valid number of dollars",
    });
  }

  const cents = Math.round(value * 100);
  if (cents <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Grant amount must be greater than zero",
    });
  }

  return cents;
}

function parseAvailableUntil(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Available-until date must be a valid ISO timestamp",
    });
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: "Available-until date must be a valid ISO timestamp",
    });
  }

  return parsed;
}

function parseStockRemaining(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Stock must be a whole number greater than or equal to zero",
    });
  }

  return value;
}

function parseMaxPerUser(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Max per user must be a whole number of 1 or more, or blank for no limit",
    });
  }

  return value;
}

// Hand-kept mirror of app/data/shopCategories.ts; Nitro and app code don't share an import root.
const SHOP_ITEM_CATEGORY_VALUES = [
  "tech",
  "food",
  "gaming",
  "apple",
  "merch",
  "grant",
  "event",
  "consumable",
  "printing",
  "tools",
  "other",
] as const;

export function normalizeShopItemBody(
  body: ShopItemWriteBody,
  existingItem?: ShopItemRow | null,
) {
  const baseValues = existingItem
    ? {
        name: existingItem.name,
        description: existingItem.description ?? null,
        name_translations: existingItem.name_translations ?? null,
        description_translations: existingItem.description_translations ?? null,
        image_url: existingItem.image_url ?? null,
        kind: existingItem.kind,
        fulfillment_provider: existingItem.fulfillment_provider,
        source: existingItem.source ?? null,
        price_hours: existingItem.price_hours,
        sale_price_hours: existingItem.sale_price_hours ?? null,
        price_fruit_type: existingItem.price_fruit_type ?? null,
        price_fruit_amount: existingItem.price_fruit_amount ?? null,
        price_fruit_level: existingItem.price_fruit_level ?? null,
        price_fruit_category: existingItem.price_fruit_category ?? null,
        grant_amount_cents: existingItem.grant_amount_cents ?? null,
        attachment_urls: existingItem.attachment_urls ?? [],
        inventory_mode: existingItem.inventory_mode,
        stock_remaining: existingItem.stock_remaining ?? null,
        max_per_user: existingItem.max_per_user ?? null,
        available_until: existingItem.available_until ?? null,
        available: existingItem.available ?? true,
        coming_soon: existingItem.coming_soon ?? false,
        requires_shipped_project: existingItem.requires_shipped_project ?? false,
        pinned: existingItem.pinned ?? false,
        extra_fruity: existingItem.extra_fruity ?? false,
        priority_eligible: existingItem.priority_eligible ?? false,
        category: existingItem.category ?? null,
        regional_pricing: existingItem.regional_pricing ?? null,
        modifiers: existingItem.modifiers ?? null,
      }
    : {
        name: "",
        description: null as string | null,
        name_translations: null as Record<string, string> | null,
        description_translations: null as Record<string, string> | null,
        image_url: null as string | null,
        kind: "physical" as const,
        fulfillment_provider: "internal" as const,
        source: "hq" as "hq" | "local" | null,
        price_hours: 0,
        sale_price_hours: null as number | null,
        price_fruit_type: null as string | null,
        price_fruit_amount: null as number | null,
        price_fruit_level: null as number | null,
        price_fruit_category: null as "software" | "hardware" | null,
        grant_amount_cents: null as number | null,
        attachment_urls: [] as string[],
        inventory_mode: "unlimited" as const,
        stock_remaining: null as number | null,
        max_per_user: null as number | null,
        available_until: null as Date | null,
        available: true,
        coming_soon: false,
        requires_shipped_project: false,
        pinned: false,
        extra_fruity: false,
        priority_eligible: false,
        category: null as string | null,
        regional_pricing: null as StoredRegionalPricing | null,
        modifiers: null as ShopItemModifier[] | null,
      };

  const values = { ...baseValues };
  let touchedFields = 0;

  if (hasOwn(body, "name")) {
    touchedFields += 1;
    const name = trimNullableText(body.name);
    if (!name) {
      throw createError({
        statusCode: 400,
        statusMessage: "Item name is required",
      });
    }
    values.name = name;
  }

  if (hasOwn(body, "description")) {
    touchedFields += 1;
    values.description = trimNullableText(body.description);
  }

  if (hasOwn(body, "nameTranslations")) {
    touchedFields += 1;
    values.name_translations = normalizeTranslations(
      body.nameTranslations,
      "nameTranslations",
    );
  }

  if (hasOwn(body, "descriptionTranslations")) {
    touchedFields += 1;
    values.description_translations = normalizeTranslations(
      body.descriptionTranslations,
      "descriptionTranslations",
    );
  }

  if (hasOwn(body, "imageUrl")) {
    touchedFields += 1;
    values.image_url = trimNullableText(body.imageUrl);
  }

  if (hasOwn(body, "kind")) {
    touchedFields += 1;
    if (
      body.kind !== "physical" &&
      body.kind !== "grant" &&
      body.kind !== "consumable" &&
      body.kind !== "experience" &&
      body.kind !== "virtual_service"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Item kind must be physical, grant, consumable, experience, or virtual service",
      });
    }
    values.kind = body.kind;
  }

  if (hasOwn(body, "fulfillmentProvider")) {
    touchedFields += 1;
    if (
      body.fulfillmentProvider !== "internal" &&
      body.fulfillmentProvider !== "theseus" &&
      body.fulfillmentProvider !== "hcb" &&
      body.fulfillmentProvider !== "internal_synthetic"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid fulfillment provider",
      });
    }
    values.fulfillment_provider = body.fulfillmentProvider;
  }

  if (hasOwn(body, "priceGold")) {
    touchedFields += 1;
    if (typeof body.priceGold !== "number" || !isValidGoldPrice(body.priceGold)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Gold price must be a non-negative multiple of 10",
      });
    }
    values.price_hours = goldToPriceHours(body.priceGold);
  }

  if (hasOwn(body, "salePriceGold")) {
    touchedFields += 1;
    if (body.salePriceGold == null) {
      values.sale_price_hours = null;
    } else {
      if (typeof body.salePriceGold !== "number" || !isValidGoldPrice(body.salePriceGold)) {
        throw createError({
          statusCode: 400,
          statusMessage: "Sale price must be a non-negative multiple of 10, or blank for no sale",
        });
      }
      // Compare against the regular price resolved above so a sale never meets or exceeds it.
      const saleHours = goldToPriceHours(body.salePriceGold);
      if (saleHours >= values.price_hours) {
        throw createError({
          statusCode: 400,
          statusMessage: "Sale price must be below the regular price",
        });
      }
      values.sale_price_hours = saleHours;
    }
  }

  if (hasOwn(body, "grantAmountDollars")) {
    touchedFields += 1;
    values.grant_amount_cents = parseGrantAmountCents(body.grantAmountDollars);
  }

  if (hasOwn(body, "attachmentUrls")) {
    touchedFields += 1;
    values.attachment_urls = normalizeAttachmentUrls(body.attachmentUrls);
  }

  if (hasOwn(body, "inventoryMode")) {
    touchedFields += 1;
    if (body.inventoryMode !== "unlimited" && body.inventoryMode !== "limited") {
      throw createError({
        statusCode: 400,
        statusMessage: "Inventory mode must be unlimited or limited",
      });
    }
    values.inventory_mode = body.inventoryMode;
  }

  if (hasOwn(body, "stockRemaining")) {
    touchedFields += 1;
    values.stock_remaining = parseStockRemaining(body.stockRemaining);
  }

  if (hasOwn(body, "maxPerUser")) {
    touchedFields += 1;
    values.max_per_user = parseMaxPerUser(body.maxPerUser);
  }

  if (hasOwn(body, "availableUntil")) {
    touchedFields += 1;
    values.available_until = parseAvailableUntil(body.availableUntil);
  }

  if (hasOwn(body, "available")) {
    touchedFields += 1;
    if (typeof body.available !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Availability must be true or false",
      });
    }
    values.available = body.available;
  }

  if (hasOwn(body, "comingSoon")) {
    touchedFields += 1;
    if (typeof body.comingSoon !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Coming soon must be true or false",
      });
    }
    values.coming_soon = body.comingSoon;
  }

  if (hasOwn(body, "requiresShippedProject")) {
    touchedFields += 1;
    if (typeof body.requiresShippedProject !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Requires shipped project must be true or false",
      });
    }
    values.requires_shipped_project = body.requiresShippedProject;
  }

  if (hasOwn(body, "pinned")) {
    touchedFields += 1;
    if (typeof body.pinned !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Pinned must be true or false",
      });
    }
    values.pinned = body.pinned;
  }

  if (hasOwn(body, "extraFruity")) {
    touchedFields += 1;
    if (typeof body.extraFruity !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Extra fruity must be true or false",
      });
    }
    values.extra_fruity = body.extraFruity;
  }

  if (hasOwn(body, "priorityEligible")) {
    touchedFields += 1;
    if (typeof body.priorityEligible !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "Priority eligible must be true or false",
      });
    }
    values.priority_eligible = body.priorityEligible;
  }

  if (hasOwn(body, "category")) {
    touchedFields += 1;
    const raw = body.category;
    if (raw == null || raw === "") {
      values.category = null;
    } else if (
      typeof raw === "string" &&
      (SHOP_ITEM_CATEGORY_VALUES as readonly string[]).includes(raw)
    ) {
      values.category = raw;
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid category",
      });
    }
  }

  if (hasOwn(body, "source")) {
    touchedFields += 1;
    if (body.source != null && body.source !== "hq" && body.source !== "local") {
      throw createError({
        statusCode: 400,
        statusMessage: "source must be 'hq', 'local', or null",
      });
    }
    values.source = body.source ?? null;
  }

  if (hasOwn(body, "regionalPricing")) {
    touchedFields += 1;
    values.regional_pricing = normalizeRegionalPricing(body.regionalPricing);
  }

  if (hasOwn(body, "modifiers")) {
    touchedFields += 1;
    values.modifiers = normalizeModifiers(body.modifiers);
  }

  // Pricing is gold-only, so the fruit-pricing columns are always written null.
  values.price_fruit_type = null;
  values.price_fruit_amount = null;
  values.price_fruit_level = null;
  values.price_fruit_category = null;

  if (existingItem && touchedFields === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No item fields were provided",
    });
  }

  if (!values.name.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: "Item name is required",
    });
  }

  if (values.price_hours < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Gold price cannot be negative",
    });
  }

  // Reject configs whose cheapest valid selection drops below 0, on top of the runtime clamp.
  if (values.modifiers && values.modifiers.length > 0) {
    let worstCaseDelta = 0;
    for (const modifier of values.modifiers) {
      if (modifier.type === "text") {
        // Required text: the delta is always charged. Optional text: the
        // buyer can skip it, so only a negative delta worsens the floor.
        const delta = modifier.price_delta_hours ?? 0;
        worstCaseDelta += modifier.required ? delta : Math.min(0, delta);
      } else if (modifier.type === "single") {
        // Required: worst case is the cheapest option; optional can be skipped, so min(0, cheapest).
        let cheapest = Infinity;
        for (const option of modifier.options) {
          if (option.price_delta_hours < cheapest) {
            cheapest = option.price_delta_hours;
          }
        }
        if (cheapest === Infinity) continue;
        if (modifier.required) {
          worstCaseDelta += cheapest;
        } else {
          worstCaseDelta += Math.min(0, cheapest);
        }
      } else {
        for (const option of modifier.options) {
          if (option.price_delta_hours < 0) {
            worstCaseDelta += option.price_delta_hours;
          }
        }
      }
    }
    if (values.price_hours + worstCaseDelta < 0) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Modifier deltas could push the price below 0. Raise the base price or adjust the deltas.",
      });
    }
  }

  // Free items need a per-user cap or one user could drain stock; internal_synthetic items enforce their own caps.
  const hasFreeRegional = Object.values(values.regional_pricing ?? {}).some(
    (override) => override != null && override.price_hours === 0,
  );
  if (
    (values.price_hours === 0 || hasFreeRegional) &&
    values.max_per_user == null &&
    values.fulfillment_provider !== "internal_synthetic"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Free items (price = 0) require a 'Max per user' cap so a single user can't drain stock",
    });
  }

  if (values.kind === "grant") {
    if (values.fulfillment_provider !== "hcb") {
      throw createError({
        statusCode: 400,
        statusMessage: "Grant items must use the HCB fulfillment provider",
      });
    }

    if (!values.grant_amount_cents || values.grant_amount_cents <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Grant items must include a valid grant amount in dollars",
      });
    }

    // Modifiers could push the cost above the fixed grant value.
    if (values.modifiers && values.modifiers.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Grant items cannot have modifiers",
      });
    }

    values.source = null;
  } else if (values.kind === "virtual_service") {
    if (values.fulfillment_provider !== "internal") {
      throw createError({
        statusCode: 400,
        statusMessage: "Virtual service items must use the internal fulfillment provider",
      });
    }

    values.grant_amount_cents = null;
    values.source = null;
    values.regional_pricing = null;
  } else if (
    values.kind === "consumable" ||
    values.kind === "experience" ||
    values.fulfillment_provider === "internal_synthetic"
  ) {
    // Code-fulfilled items bypass shop_orders and run server logic keyed off the slug.
    if (values.fulfillment_provider !== "internal_synthetic") {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Consumable / experience items must use the code-fulfilled provider (internal_synthetic)",
      });
    }
    values.grant_amount_cents = null;
    values.source = null;
  } else {
    if (!["internal", "theseus"].includes(values.fulfillment_provider)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Physical items must use internal or Theseus fulfillment",
      });
    }

    values.grant_amount_cents = null;

    if (values.source == null) {
      values.source = "hq";
    }
  }

  if (values.inventory_mode === "limited") {
    if (values.stock_remaining == null) {
      throw createError({
        statusCode: 400,
        statusMessage: "Limited items must include a stock count",
      });
    }
  } else {
    values.stock_remaining = null;
  }

  return values;
}

/** Token overlap lets "Meta Quest 3" match "Meta Quest 3/3s". */
export async function dismissMatchingSuggestions(
  itemName: string,
  actorId: string,
  reason = "Already covered by an existing shop item.",
): Promise<number> {
  const normalized = itemName.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const stopWords = new Set([
    "a", "an", "the", "for", "to", "of", "and", "or", "in", "on", "at",
    "by", "with", "please", "add", "new", "buy", "get", "grant", "stackable",
  ]);
  const tokens = normalized
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stopWords.has(t));

  if (tokens.length === 0) return 0;

  // One-token names like "RAM" are too risky for substring matching because
  // they can match unrelated words like "programming". Use exact ilike there.
  const fullMatch = ilike(
    shopItemRequestTable.name,
    tokens.length === 1 ? normalized : `%${normalized}%`,
  );
  const tokenConds = tokens.map((t) => ilike(shopItemRequestTable.name, `%${t}%`));
  const match = tokens.length === 1
    ? fullMatch
    : or(fullMatch, and(tokenConds[0], tokenConds[1]));

  const rows = await db
    .select({ id: shopItemRequestTable.id })
    .from(shopItemRequestTable)
    .where(
      and(
        isNull(shopItemRequestTable.dismissed_at),
        isNull(shopItemRequestTable.promoted_to_item_id),
        match,
      ),
    );

  if (rows.length > 0) {
    await db
      .update(shopItemRequestTable)
      .set({
        dismissed_at: new Date(),
        dismissed_by: actorId,
        dismissed_reason: reason,
      })
      .where(inArray(shopItemRequestTable.id, rows.map((r) => r.id)));
  }

  return rows.length;
}
