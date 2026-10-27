// shop.ts uses Nitro's auto-imported createError, so shim it before importing the module.

import { beforeAll, describe, expect, mock, test } from "bun:test";

import { SHOP_REGIONS } from "./regions";

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
// mock.module is process-global, so this must export everything other suites import from slack-bot.
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

let validateAndResolveSelectedModifiers: typeof import("./shop").validateAndResolveSelectedModifiers;
let getOrderItemSnapshot: typeof import("./shop").getOrderItemSnapshot;
let canPurchaseWithPriorityGold: typeof import("./shop").canPurchaseWithPriorityGold;
beforeAll(async () => {
  ({ validateAndResolveSelectedModifiers, getOrderItemSnapshot, canPurchaseWithPriorityGold } =
    await import("./shop"));
});

const engraving = (overrides: Record<string, unknown> = {}) => ({
  id: "engraving",
  label: "Engraving",
  type: "text" as const,
  required: false,
  options: [],
  max_length: 25,
  price_delta_hours: 0,
  ...overrides,
});

describe("text modifiers", () => {
  test("resolves entered text into the sentinel option and text_value", () => {
    const { resolved, priceHoursPerUnit } = validateAndResolveSelectedModifiers(
      [engraving()],
      [{ modifier_id: "engraving", text: "para Sofia <3" }],
      100,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.type).toBe("text");
    expect(resolved[0]!.options).toEqual([
      { option_id: "text", label: "para Sofia <3", price_delta_hours: 0 },
    ]);
    expect(resolved[0]!.text_value).toBe("para Sofia <3");
    expect(priceHoursPerUnit).toBe(100);
  });

  test("charges the flat delta once when text is provided", () => {
    const { priceHoursPerUnit } = validateAndResolveSelectedModifiers(
      [engraving({ price_delta_hours: 5 })],
      [{ modifier_id: "engraving", text: "hi" }],
      100,
    );
    expect(priceHoursPerUnit).toBe(105);
  });

  test("optional text omitted or blank resolves to nothing and no delta", () => {
    for (const input of [
      [],
      [{ modifier_id: "engraving", text: "" }],
      [{ modifier_id: "engraving", text: "   " }],
    ]) {
      const { resolved, priceHoursPerUnit } = validateAndResolveSelectedModifiers(
        [engraving({ price_delta_hours: 5 })],
        input as never,
        100,
      );
      expect(resolved).toHaveLength(0);
      expect(priceHoursPerUnit).toBe(100);
    }
  });

  test("required text rejects blank with a 400", () => {
    expect(() =>
      validateAndResolveSelectedModifiers(
        [engraving({ required: true })],
        [{ modifier_id: "engraving", text: "  " }],
        100,
      ),
    ).toThrow(/Enter text/);
  });

  test("rejects text longer than max_length", () => {
    expect(() =>
      validateAndResolveSelectedModifiers(
        [engraving({ max_length: 5 })],
        [{ modifier_id: "engraving", text: "toolongtext" }],
        100,
      ),
    ).toThrow(/5 characters or fewer/);
  });

  test("clamps a silly max_length to the 200 hard cap", () => {
    expect(() =>
      validateAndResolveSelectedModifiers(
        [engraving({ max_length: 9999 })],
        [{ modifier_id: "engraving", text: "x".repeat(201) }],
        100,
      ),
    ).toThrow(/200 characters or fewer/);
  });

  test("collapses newlines to spaces and strips control characters", () => {
    const { resolved } = validateAndResolveSelectedModifiers(
      [engraving({ max_length: 50 })],
      [{ modifier_id: "engraving", text: "line1\r\nline2 end" }],
      100,
    );
    expect(resolved[0]!.text_value).toBe("line1 line2 end");
  });

  test("preserves interior spacing (engraving spacing is intentional)", () => {
    const { resolved } = validateAndResolveSelectedModifiers(
      [engraving({ max_length: 50 })],
      [{ modifier_id: "engraving", text: "  A    B  " }],
      100,
    );
    expect(resolved[0]!.text_value).toBe("A    B");
  });

  test("rejects option ids sent against a text modifier", () => {
    expect(() =>
      validateAndResolveSelectedModifiers(
        [engraving()],
        [{ modifier_id: "engraving", option_id: "text" }],
        100,
      ),
    ).toThrow(/takes free text/);
  });

  test("rejects text sent against a choice modifier", () => {
    const colorModifier = {
      id: "color",
      label: "Color",
      type: "single" as const,
      required: false,
      options: [{ id: "red", label: "Red", price_delta_hours: 0 }],
    };
    // a text entry has no option_id, so it's treated as missing
    expect(() =>
      validateAndResolveSelectedModifiers(
        [{ ...colorModifier, required: true }],
        [{ modifier_id: "color", text: "red" }],
        100,
      ),
    ).toThrow(/Pick an option/);
  });

  test("text and choice modifiers coexist on one item", () => {
    const { resolved, priceHoursPerUnit } = validateAndResolveSelectedModifiers(
      [
        {
          id: "model",
          label: "Model",
          type: "single" as const,
          required: true,
          options: [
            { id: "ipad-11", label: "iPad 11\"", price_delta_hours: 0 },
            { id: "ipad-air", label: "iPad Air", price_delta_hours: 250 },
          ],
        },
        engraving(),
      ],
      [
        { modifier_id: "model", option_id: "ipad-air" },
        { modifier_id: "engraving", text: "happy hacking" },
      ],
      349,
    );
    expect(resolved).toHaveLength(2);
    expect(priceHoursPerUnit).toBe(599);
  });
});

// getOrderItemSnapshot only reads order.item_snapshot
describe("getOrderItemSnapshot region deserialization", () => {
  const baseSnapshot = {
    id: 42,
    slug: "deck-of-cards",
    name: "Deck of Cards",
    kind: "physical",
    fulfillment_provider: "internal",
    source: "hq",
    price_hours: 10,
    price_gold: 100,
  };
  const orderWith = (region: unknown) =>
    ({ item_snapshot: { ...baseSnapshot, region } }) as never;

  test("every canonical shop region round-trips", () => {
    for (const region of SHOP_REGIONS) {
      const snapshot = getOrderItemSnapshot(orderWith(region));
      expect(snapshot).not.toBeNull();
      expect(snapshot!.region).toBe(region);
    }
  });

  // regression: a hardcoded region whitelist once missed BR
  test("Brazil (BR) survives the round-trip", () => {
    expect(getOrderItemSnapshot(orderWith("BR"))!.region).toBe("BR");
  });

  test("invalid or missing region deserializes to null", () => {
    for (const region of ["XX", "br", "", null, undefined, 42]) {
      const snapshot = getOrderItemSnapshot(orderWith(region));
      expect(snapshot).not.toBeNull();
      expect(snapshot!.region).toBeNull();
    }
  });
});

describe("priority-gold catalog", () => {
  // regression: priority gold exists to pay for these, even if the flag was left off
  test("the event-tied catalog is eligible even when the flag is off", () => {
    for (const slug of [
      "event_invite",
      "travel_stipend",
      "pre_event_accommodation",
      "post_event_accommodation",
    ]) {
      expect(canPurchaseWithPriorityGold({ slug, priority_eligible: false })).toBe(true);
    }
  });

  test("everything else follows the staff checkbox", () => {
    expect(canPurchaseWithPriorityGold({ slug: "streak_freeze", priority_eligible: false })).toBe(
      false,
    );
    expect(canPurchaseWithPriorityGold({ slug: null, priority_eligible: false })).toBe(false);
    expect(canPurchaseWithPriorityGold({ slug: "game_factorio", priority_eligible: true })).toBe(
      true,
    );
  });
});
