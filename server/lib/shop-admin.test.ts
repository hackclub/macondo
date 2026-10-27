// shop-admin.ts uses Nitro's auto-imported createError, so it's shimmed onto globalThis before the import.

import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("../db", () => ({ default: {} }));
mock.module("./hcb", () => ({
  createHcbClient: () => ({}),
  hcbGrantInfoCacheKey: (id: string) => `hcb:${id}`,
  invalidateHcbGrantInfoCache: async () => {},
}));
mock.module("./redis", () => {
  const getRedis = async () => null;
  return { getRedis, default: getRedis };
});
mock.module("./slack-bot", () => ({
  postMessage: async () => ({ ok: false, error: "stubbed" }),
  postWebhook: async () => ({ ok: false, error: "stubbed" }),
  dm: async () => ({ ok: false, error: "stubbed" }),
}));

type H3LikeError = Error & { statusCode?: number; statusMessage?: string };

(globalThis as Record<string, unknown>).createError = (input: {
  statusCode?: number;
  statusMessage?: string;
}) => {
  const err = new Error(input.statusMessage ?? "error") as H3LikeError;
  err.statusCode = input.statusCode;
  err.statusMessage = input.statusMessage;
  return err;
};

let normalizeShopItemBody: typeof import("./shop-admin").normalizeShopItemBody;
beforeAll(async () => {
  ({ normalizeShopItemBody } = await import("./shop-admin"));
});

const baseCreateBody = { name: "Event Hoodie", priceGold: 100 };

describe("normalizeShopItemBody priorityEligible", () => {
  test("defaults to false when the field is absent", () => {
    expect(normalizeShopItemBody({ ...baseCreateBody }).priority_eligible).toBe(false);
  });

  test("persists an explicit true", () => {
    expect(
      normalizeShopItemBody({
        ...baseCreateBody,
        priorityEligible: true,
      }).priority_eligible,
    ).toBe(true);
  });

  test("rejects non-boolean input", () => {
    expect(() =>
      normalizeShopItemBody({
        ...baseCreateBody,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priorityEligible: "yes" as any,
      }),
    ).toThrow("Priority eligible must be true or false");
  });

  test("preserves the stored value on a partial edit that omits the field", () => {
    const existing = {
      priority_eligible: true,
      name: "Event Hoodie",
      description: null,
      name_translations: null,
      description_translations: null,
      image_url: null,
      kind: "physical",
      fulfillment_provider: "internal",
      source: "hq",
      price_hours: 10,
      sale_price_hours: null,
      price_fruit_type: null,
      price_fruit_amount: null,
      price_fruit_level: null,
      price_fruit_category: null,
      grant_amount_cents: null,
      attachment_urls: [],
      inventory_mode: "unlimited",
      stock_remaining: null,
      max_per_user: null,
      available_until: null,
      available: true,
      coming_soon: false,
      requires_shipped_project: false,
      pinned: false,
      extra_fruity: false,
      category: null,
      regional_pricing: null,
      modifiers: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const values = normalizeShopItemBody({ priceGold: 200 }, existing);
    expect(values.priority_eligible).toBe(true);
    expect(values.price_hours).toBe(20);
  });

  test("clears the flag when an edit sends false", () => {
    const existing = {
      priority_eligible: true,
      name: "Event Hoodie",
      description: null,
      name_translations: null,
      description_translations: null,
      image_url: null,
      kind: "physical",
      fulfillment_provider: "internal",
      source: "hq",
      price_hours: 10,
      sale_price_hours: null,
      price_fruit_type: null,
      price_fruit_amount: null,
      price_fruit_level: null,
      price_fruit_category: null,
      grant_amount_cents: null,
      attachment_urls: [],
      inventory_mode: "unlimited",
      stock_remaining: null,
      max_per_user: null,
      available_until: null,
      available: true,
      coming_soon: false,
      requires_shipped_project: false,
      pinned: false,
      extra_fruity: false,
      category: null,
      regional_pricing: null,
      modifiers: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(
      normalizeShopItemBody({ priorityEligible: false }, existing).priority_eligible,
    ).toBe(false);
  });
});
