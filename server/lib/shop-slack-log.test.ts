// ../db and ./slack-bot need Nuxt's #imports alias, so mock them and shim Nitro globals before importing.

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// only the exact query shapes shop-slack-log.ts uses are implemented
type FakeRow = Record<string, unknown> & { id: number };
const pendingRows: FakeRow[] = [];
let nextRowId = 1;

mock.module("../db", () => ({
  default: {
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        pendingRows.push({ id: nextRowId++, created_at: new Date(0), ...values });
      },
    }),
    select: () => ({
      from: () => ({
        orderBy: async () => [...pendingRows],
      }),
    }),
    delete: () => ({
      where: async () => {
        pendingRows.length = 0;
      },
    }),
  },
}));
mock.module("./hcb", () => ({
  createHcbClient: () => ({}),
  hcbGrantInfoCacheKey: (id: string) => `hcb:${id}`,
  invalidateHcbGrantInfoCache: async () => {},
}));
mock.module("./redis", () => {
  const getRedis = async () => null;
  return { getRedis, default: getRedis };
});

const webhookMock = mock(
  async (
    _url: string,
    _payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => ({ ok: true }),
);
// shop.ts's import graph pulls other slack-bot exports too, so stub them all
const slackStub = async () => ({ ok: false, error: "stubbed" });
mock.module("./slack-bot", () => ({
  postWebhook: (url: string, payload: Record<string, unknown>) =>
    webhookMock(url, payload),
  postMessage: slackStub,
  updateMessage: slackStub,
  openConversation: slackStub,
  dm: slackStub,
  addReaction: slackStub,
  removeReaction: slackStub,
  conversationMembers: slackStub,
  inviteToConversation: slackStub,
  kickFromConversation: slackStub,
  conversationsHistory: slackStub,
  conversationsReplies: slackStub,
  verifySignature: () => false,
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

// not a hooks.slack.com URL because secret scanners flag that shape
const WEBHOOK_URL = "https://webhook.test.invalid/services/T0/B0/xxxx";

let runtimeConfig: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).useRuntimeConfig = () => runtimeConfig;

let diffShopItemFields: typeof import("./shop-slack-log").diffShopItemFields;
let mergePendingShopChanges: typeof import("./shop-slack-log").mergePendingShopChanges;
let buildShopItemLogBlocks: typeof import("./shop-slack-log").buildShopItemLogBlocks;
let queueShopItemChange: typeof import("./shop-slack-log").queueShopItemChange;
let listPendingShopChanges: typeof import("./shop-slack-log").listPendingShopChanges;
let publishPendingShopChanges: typeof import("./shop-slack-log").publishPendingShopChanges;
let getShopItemAuditMetadata: typeof import("./shop").getShopItemAuditMetadata;
beforeAll(async () => {
  ({
    diffShopItemFields,
    mergePendingShopChanges,
    buildShopItemLogBlocks,
    queueShopItemChange,
    listPendingShopChanges,
    publishPendingShopChanges,
  } = await import("./shop-slack-log"));
  ({ getShopItemAuditMetadata } = await import("./shop"));
});

beforeEach(() => {
  runtimeConfig = { slackShopLogWebhookUrl: WEBHOOK_URL };
  pendingRows.length = 0;
  nextRowId = 1;
  webhookMock.mockClear();
  webhookMock.mockImplementation(async () => ({ ok: true }));
});

type AnyItem = Record<string, unknown>;

const baseItem = (overrides: AnyItem = {}): AnyItem => ({
  id: 42,
  slug: null,
  name: "Raspberry Pi 5",
  description: "A tiny computer",
  name_translations: null,
  description_translations: null,
  price_hours: 12,
  price_fruit_type: null,
  price_fruit_amount: null,
  price_fruit_level: null,
  price_fruit_category: null,
  image_url: "https://cdn.hackclub.com/pi5.png",
  kind: "physical",
  fulfillment_provider: "internal",
  source: null,
  grant_amount_cents: null,
  attachment_urls: [],
  inventory_mode: "unlimited",
  stock_remaining: null,
  max_per_user: null,
  sale_price_hours: null,
  available_until: null,
  available: true,
  coming_soon: false,
  requires_shipped_project: false,
  pinned: false,
  extra_fruity: false,
  regional_pricing: null,
  modifiers: null,
  category: "hardware",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asItem = (item: AnyItem) => item as any;

const findCarousel = (blocks: Array<Record<string, unknown>>) =>
  blocks.find((b) => b.type === "carousel") as
    | { type: string; elements: Array<Record<string, unknown>> }
    | undefined;

const cardText = (card: Record<string, unknown>, part: "title" | "subtitle" | "body") =>
  (card[part] as { text: string }).text;

const cardDiffText = (card: Record<string, unknown>) =>
  ["body", "subtext"]
    .map((part) => (card[part] as { text: string } | undefined)?.text)
    .filter((text): text is string => Boolean(text))
    .join("\n");

describe("diffShopItemFields", () => {
  test("update lists changed fields with old and new text", () => {
    const prev = baseItem();
    const next = baseItem({ name: "Raspberry Pi 500", price_hours: 20, available: false });
    const byKey = Object.fromEntries(
      diffShopItemFields(asItem(prev), asItem(next)).map((d) => [d.key, d]),
    );

    expect(Object.keys(byKey).sort()).toEqual(["available", "name", "price_hours"]);
    expect(byKey.name).toEqual({
      key: "name",
      label: "Name",
      oldText: "Raspberry Pi 5",
      newText: "Raspberry Pi 500",
    });
    expect(byKey.price_hours!.oldText).toBe("120 gold ($12)");
    expect(byKey.price_hours!.newText).toBe("200 gold ($20)");
    expect(byKey.available!.oldText).toBe("Yes");
    expect(byKey.available!.newText).toBe("No");
  });

  test("ignores created_at/updated_at and returns empty on identical rows", () => {
    const prev = baseItem();
    expect(
      diffShopItemFields(
        asItem(prev),
        asItem(baseItem({ updated_at: new Date("2026-06-01T00:00:00Z") })),
      ),
    ).toEqual([]);
    expect(diffShopItemFields(asItem(prev), asItem(baseItem()))).toEqual([]);
  });

  test("jsonb columns diff by content, not identity", () => {
    const pricing = { EU: { price_hours: 15, available: true } };
    const prev = baseItem({ regional_pricing: { ...pricing } });
    const same = baseItem({ regional_pricing: { EU: { price_hours: 15, available: true } } });
    expect(diffShopItemFields(asItem(prev), asItem(same))).toEqual([]);

    const changed = baseItem({ regional_pricing: { EU: { price_hours: 30, available: true } } });
    const diffs = diffShopItemFields(asItem(prev), asItem(changed));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.key).toBe("regional_pricing");
    expect(diffs[0]!.oldText).toContain("EU: 150 gold ($15)");
    expect(diffs[0]!.newText).toContain("EU: 300 gold ($30)");
  });

  test("create lists only non-default fields, with null oldText", () => {
    const diffs = diffShopItemFields(null, asItem(baseItem()));
    const keys = diffs.map((d) => d.key);

    expect(keys).toContain("name");
    expect(keys).toContain("price_hours");
    expect(keys).toContain("available");
    expect(keys).not.toContain("coming_soon");
    expect(keys).not.toContain("slug");
    expect(keys).not.toContain("attachment_urls");
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("created_at");
    for (const diff of diffs) {
      expect(diff.oldText).toBeNull();
      expect(diff.newText).not.toBeNull();
    }
  });

  test("delete mirrors create with null newText", () => {
    const diffs = diffShopItemFields(asItem(baseItem()), null);
    expect(diffs.length).toBeGreaterThan(0);
    for (const diff of diffs) {
      expect(diff.newText).toBeNull();
      expect(diff.oldText).not.toBeNull();
    }
  });
});

describe("mergePendingShopChanges", () => {
  const row = (id: number, itemId: number, oldValue: AnyItem | null, newValue: AnyItem | null) => ({
    id,
    item_id: itemId,
    old_value: oldValue,
    new_value: newValue,
  });

  test("collapses sequential edits of one item into first-old vs last-new", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, baseItem(), baseItem({ price_hours: 20 })),
      row(2, 42, baseItem({ price_hours: 20 }), baseItem({ price_hours: 20, name: "Pi 500" })),
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.action).toBe("update_shop_item");
    expect(
      diffShopItemFields(changes[0]!.oldItem, changes[0]!.newItem)
        .map((d) => d.key)
        .sort(),
    ).toEqual(["name", "price_hours"]);
  });

  test("drops items whose edits revert to the original", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, baseItem(), baseItem({ price_hours: 20 })),
      row(2, 42, baseItem({ price_hours: 20 }), baseItem()),
    ]);
    expect(changes).toEqual([]);
  });

  test("create then update announces as a create of the final state", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, null, baseItem()),
      row(2, 42, baseItem(), baseItem({ price_hours: 20 })),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.action).toBe("create_shop_item");
    expect(changes[0]!.oldItem).toBeNull();
    expect((changes[0]!.newItem as AnyItem).price_hours).toBe(20);
  });

  test("update then delete announces as a delete", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, baseItem(), baseItem({ price_hours: 20 })),
      row(2, 42, baseItem({ price_hours: 20 }), null),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.action).toBe("delete_shop_item");
    expect(changes[0]!.newItem).toBeNull();
  });

  test("create then delete before publishing drops out entirely", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, null, baseItem()),
      row(2, 42, baseItem(), null),
    ]);
    expect(changes).toEqual([]);
  });

  test("keeps separate items separate and re-derives specific actions", () => {
    const changes = mergePendingShopChanges([
      row(1, 42, baseItem({ stock_remaining: 1, inventory_mode: "limited" }), baseItem({ stock_remaining: 9, inventory_mode: "limited" })),
      row(2, 7, null, baseItem({ id: 7, name: "Sticker" })),
    ]);
    expect(changes).toHaveLength(2);
    const byAction = Object.fromEntries(changes.map((c) => [c.action, c]));
    expect(byAction.restock_shop_item).toBeDefined();
    expect(byAction.create_shop_item).toBeDefined();
  });
});

describe("buildShopItemLogBlocks (carousel)", () => {
  test("create renders only a carousel with one self-contained card for the item", () => {
    const result = buildShopItemLogBlocks({
      changes: [{ action: "create_shop_item", oldItem: null, newItem: asItem(baseItem()) }],
    })!;

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.type).toBe("carousel");
    expect(result.blocks[1]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "<!channel>" }],
    });

    const carousel = findCarousel(result.blocks)!;
    expect(carousel.elements).toHaveLength(1);
    const card = carousel.elements[0]!;
    expect(card.type).toBe("card");
    expect(cardText(card, "title")).toBe("*Raspberry Pi 5*");
    expect(cardText(card, "subtitle")).toContain("🆕");
    expect(card.icon).toBeUndefined();
    expect((card.hero_image as { image_url: string }).image_url).toBe(
      "https://cdn.hackclub.com/pi5.png",
    );
    expect(cardDiffText(card)).toContain("*Name:* Raspberry Pi 5");
    expect(cardDiffText(card)).toContain("*Price:* 120 gold ($12)");
  });

  test("update card stacks every changed field in the body", () => {
    const result = buildShopItemLogBlocks({
      changes: [
        {
          action: "update_shop_item",
          oldItem: asItem(baseItem()),
          newItem: asItem(baseItem({ price_hours: 20, extra_fruity: true })),
        },
      ],
    })!;

    const carousel = findCarousel(result.blocks)!;
    expect(carousel.elements).toHaveLength(1);
    const card = carousel.elements[0]!;
    expect(cardText(card, "title")).toBe("*Raspberry Pi 5*");
    expect(cardText(card, "subtitle")).toBe("✏️ Shop item updated");
    expect(cardText(card, "body")).toBe(
      "*Price:* ~120 gold ($12)~ → 200 gold ($20)\n*Extra fruity (starfruit-gated):* ~No~ → Yes",
    );
    expect(card.subtext).toBeUndefined();
    expect((card.hero_image as { image_url: string }).image_url).toBe(
      "https://cdn.hackclub.com/pi5.png",
    );
  });

  test("many changes on one item stay on the card, spilling body → subtext", () => {
    const result = buildShopItemLogBlocks({
      changes: [
        {
          action: "update_shop_item",
          oldItem: asItem(baseItem()),
          newItem: asItem(
            baseItem({
              name: "Raspberry Pi 500",
              description: "A slightly larger tiny computer",
              category: "hardware-kits",
              price_hours: 20,
              sale_price_hours: 15,
              max_per_user: 2,
              inventory_mode: "limited",
              stock_remaining: 25,
              coming_soon: true,
              pinned: true,
              extra_fruity: true,
            }),
          ),
        },
      ],
    })!;

    const card = findCarousel(result.blocks)!.elements[0]!;
    const text = cardDiffText(card);

    for (const label of [
      "Name",
      "Description",
      "Category",
      "Price",
      "Sale Price",
      "Stock Remaining",
      "Inventory",
      "Coming Soon",
      "Max per user",
      "Pinned to top",
      "Extra fruity (starfruit-gated)",
    ]) {
      expect(text).toContain(`*${label}:*`);
    }
    expect(text).not.toContain("more field");
    expect(card.subtext).toBeDefined();
    expect(cardText(card, "body").length).toBeLessThanOrEqual(200);
    expect((card.subtext as { text: string }).text.length).toBeLessThanOrEqual(200);
  });

  test("card layout is skippable for subtext-less workspaces", () => {
    const changes = [
      {
        action: "create_shop_item",
        oldItem: null,
        newItem: asItem(baseItem()),
      },
    ];
    const card = findCarousel(
      buildShopItemLogBlocks({ changes, allowSubtext: false })!.blocks,
    )!.elements[0]!;

    expect(card.subtext).toBeUndefined();
    expect(cardText(card, "body").length).toBeLessThanOrEqual(200);
    for (const label of ["Name", "Description", "Price", "Fulfillment"]) {
      expect(cardText(card, "body")).toContain(`*${label}:*`);
    }
  });

  test("multiple changed items become one card each in a single carousel", () => {
    const result = buildShopItemLogBlocks({
      changes: [
        {
          action: "update_shop_item",
          oldItem: asItem(baseItem()),
          newItem: asItem(baseItem({ price_hours: 20 })),
        },
        {
          action: "create_shop_item",
          oldItem: null,
          newItem: asItem(baseItem({ id: 7, name: "Sticker", image_url: null })),
        },
        {
          action: "delete_shop_item",
          oldItem: asItem(baseItem({ id: 9, name: "Old Kit" })),
          newItem: null,
        },
      ],
    })!;

    expect(result.blocks).toHaveLength(2);
    const carousel = findCarousel(result.blocks)!;
    expect(carousel.elements).toHaveLength(3);
    expect(carousel.elements.map((c) => cardText(c, "title"))).toEqual([
      "*Raspberry Pi 5*",
      "*Sticker*",
      "*Old Kit*",
    ]);
    expect(carousel.elements[1]!.hero_image).toBeUndefined();
    expect(carousel.elements[0]!.hero_image).toBeDefined();
  });

  test("archive renders exactly like a delete: removal presentation, all fields struck through", () => {
    const archived = buildShopItemLogBlocks({
      changes: [
        {
          action: "archive_shop_item",
          oldItem: asItem(baseItem()),
          newItem: asItem(baseItem({ available: false })),
        },
      ],
    })!;
    const deleted = buildShopItemLogBlocks({
      changes: [
        { action: "delete_shop_item", oldItem: asItem(baseItem()), newItem: null },
      ],
    })!;

    expect(archived.blocks).toEqual(deleted.blocks);
    const card = findCarousel(archived.blocks)!.elements[0]!;
    expect(cardText(card, "subtitle")).toBe("🗑️ Shop item removed");
    expect(cardDiffText(card)).toContain("*Name:* ~Raspberry Pi 5~");
  });

  test("invalid item image URL yields a card without a hero image", () => {
    const result = buildShopItemLogBlocks({
      changes: [
        {
          action: "update_shop_item",
          oldItem: asItem(baseItem({ image_url: "not a url", name: "Old Box" })),
          newItem: asItem(baseItem({ image_url: "not a url", name: "Mystery Box" })),
        },
      ],
    })!;

    for (const card of findCarousel(result.blocks)!.elements) {
      expect(card.icon).toBeUndefined();
      expect(card.hero_image).toBeUndefined();
    }
  });

  test("caps at 10 cards with an overflow card listing the remaining items", () => {
    const changes = Array.from({ length: 12 }, (_, i) => ({
      action: "update_shop_item",
      oldItem: asItem(baseItem({ id: i + 1, name: `Item ${i + 1}` })),
      newItem: asItem(baseItem({ id: i + 1, name: `Item ${i + 1}`, price_hours: 20 })),
    }));

    const carousel = findCarousel(buildShopItemLogBlocks({ changes })!.blocks)!;
    expect(carousel.elements).toHaveLength(10);
    const overflowCard = carousel.elements[9]!;
    expect(cardText(overflowCard, "title")).toContain("3 more items");
    expect(cardText(overflowCard, "body")).toContain("Item 10");
    expect(cardText(overflowCard, "body")).toContain("Item 12");
  });

  test("returns null when nothing is renderable", () => {
    expect(buildShopItemLogBlocks({ changes: [] })).toBeNull();
    expect(
      buildShopItemLogBlocks({
        changes: [
          { action: "update_shop_item", oldItem: asItem(baseItem()), newItem: asItem(baseItem()) },
        ],
      }),
    ).toBeNull();
  });
});

describe("buildShopItemLogBlocks (sections fallback)", () => {
  test("renders header, context, and per-item lines without a carousel", () => {
    const result = buildShopItemLogBlocks({
      changes: [
        {
          action: "update_shop_item",
          oldItem: asItem(baseItem()),
          newItem: asItem(baseItem({ price_hours: 20 })),
        },
        {
          action: "delete_shop_item",
          oldItem: asItem(baseItem({ id: 9, name: "Old Kit" })),
          newItem: null,
        },
      ],
      style: "sections",
    })!;

    expect(findCarousel(result.blocks)).toBeUndefined();
    const header = result.blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("2 items");

    const serialized = JSON.stringify(result.blocks);
    expect(serialized).toContain("Shop item updated: Raspberry Pi 5");
    expect(serialized).toContain("Shop item removed: Old Kit");
    expect(serialized).toContain("~120 gold ($12)~ → 200 gold ($20)");

    expect(result.blocks[result.blocks.length - 1]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "<!channel>" }],
    });
  });

  test("single change keeps its specific presentation in the header", () => {
    const header = buildShopItemLogBlocks({
      changes: [
        { action: "create_shop_item", oldItem: null, newItem: asItem(baseItem()) },
      ],
      style: "sections",
    })!.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("🆕");
    expect(header.text.text).toContain("Raspberry Pi 5");
  });
});

describe("privacy — the channel is user-visible", () => {
  const variants = [
    [{ action: "create_shop_item", oldItem: null, newItem: asItem(baseItem()) }],
    [
      {
        action: "update_shop_item",
        oldItem: asItem(baseItem()),
        newItem: asItem(baseItem({ name: "New name", stock_remaining: 5 })),
      },
      { action: "delete_shop_item", oldItem: asItem(baseItem({ id: 9 })), newItem: null },
    ],
  ];

  for (const style of ["carousel", "sections"] as const) {
    test(`${style} blocks carry no actions, no /internal links, no actor identity`, () => {
      for (const changes of variants) {
        const serialized = JSON.stringify(buildShopItemLogBlocks({ changes, style })!.blocks);
        expect(serialized).not.toContain('"actions"');
        expect(serialized).not.toContain("/internal");
        expect(serialized).not.toContain("<@");
      }
    });
  }
});

describe("size limits", () => {
  const everyFieldChanged = () => {
    const hugeRegionalPricing: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      hugeRegionalPricing[`R${i}`] = {
        price_hours: i,
        available: i % 2 === 0,
        store_url: `https://example.com/${"x".repeat(180)}/${i}`,
      };
    }
    const prev = baseItem();
    const next = baseItem({
      slug: "pi-500",
      name: "Renamed",
      description: "d".repeat(900),
      name_translations: { es: "Pi" },
      description_translations: { es: "desc" },
      price_hours: 99,
      price_fruit_type: "Watermelon",
      price_fruit_amount: 3,
      price_fruit_level: 2,
      price_fruit_category: "software",
      image_url: "https://cdn.hackclub.com/other.png",
      kind: "grant",
      fulfillment_provider: "hcb",
      source: "hq",
      grant_amount_cents: 12345,
      attachment_urls: ["https://cdn.hackclub.com/a.pdf"],
      inventory_mode: "limited",
      stock_remaining: 7,
      max_per_user: 2,
      sale_price_hours: 50,
      available_until: new Date("2026-12-01T00:00:00Z"),
      available: false,
      coming_soon: true,
      requires_shipped_project: true,
      pinned: true,
      extra_fruity: true,
      regional_pricing: hugeRegionalPricing,
      modifiers: [
        { id: "color", label: "Color", type: "single", options: [{ id: "r", label: "Red", price_delta_hours: 0 }] },
      ],
      category: "grants",
    });
    return { prev, next };
  };

  const everyTextIn = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => everyTextIn(v, out));
    else if (typeof value === "object" && value !== null) {
      Object.values(value).forEach((v) => everyTextIn(v, out));
    }
    return out;
  };

  // Slack rejects the whole carousel if any card field is over its cap
  const CARD_LIMITS = { title: 150, subtitle: 150, body: 200, subtext: 200 };

  const expectCardLimits = (cards: Array<Record<string, unknown>>) => {
    for (const card of cards) {
      for (const [part, max] of Object.entries(CARD_LIMITS)) {
        const text = (card[part] as { text: string } | undefined)?.text;
        if (text !== undefined) expect(text.length).toBeLessThanOrEqual(max);
      }
    }
  };

  test("every card field respects Slack's card block caps", () => {
    const { prev, next } = everyFieldChanged();
    const result = buildShopItemLogBlocks({
      changes: [
        { action: "update_shop_item", oldItem: asItem(prev), newItem: asItem(next) },
      ],
    })!;

    const carousel = findCarousel(result.blocks)!;
    expect(carousel.elements).toHaveLength(1);
    expectCardLimits(carousel.elements);
  });

  test("card caps hold for long names, many items, and no subtext", () => {
    const { prev, next } = everyFieldChanged();
    const changes = Array.from({ length: 14 }, (_, i) => ({
      action: "update_shop_item",
      oldItem: asItem({ ...prev, id: i + 1, name: "N".repeat(400) }),
      newItem: asItem({ ...next, id: i + 1, name: "M".repeat(400) }),
    }));

    for (const allowSubtext of [true, false]) {
      const result = buildShopItemLogBlocks({ changes, allowSubtext })!;
      const carousel = findCarousel(result.blocks)!;
      expect(carousel.elements).toHaveLength(10);
      expectCardLimits(carousel.elements);
      if (!allowSubtext) {
        for (const card of carousel.elements) expect(card.subtext).toBeUndefined();
      }
    }
  });

  test("sections fallback stays within block and text limits", () => {
    const { prev, next } = everyFieldChanged();
    const changes = Array.from({ length: 20 }, (_, i) => ({
      action: "update_shop_item",
      oldItem: asItem({ ...prev, id: i + 1 }),
      newItem: asItem({ ...next, id: i + 1 }),
    }));
    const result = buildShopItemLogBlocks({ changes, style: "sections" })!;

    expect(result.blocks.length).toBeLessThanOrEqual(50);
    expect(findCarousel(result.blocks)).toBeUndefined();
    for (const text of everyTextIn(result.blocks)) {
      expect(text.length).toBeLessThanOrEqual(3000);
    }
  });
});

describe("getShopItemAuditMetadata still classifies actions post-refactor", () => {
  test.each([
    ["archive_shop_item", baseItem(), baseItem({ available: false })],
    ["restock_shop_item", baseItem({ stock_remaining: 1 }), baseItem({ stock_remaining: 9 })],
    ["hype_shop_item", baseItem(), baseItem({ coming_soon: true })],
    ["launch_shop_item", baseItem({ coming_soon: true }), baseItem()],
    ["update_shop_item", baseItem(), baseItem({ name: "Other", available: false })],
  ] as const)("%s", (action, prev, next) => {
    expect(getShopItemAuditMetadata(asItem(prev), asItem(next)).action).toBe(action);
  });

  test("create_shop_item when there is no previous item", () => {
    expect(getShopItemAuditMetadata(null, asItem(baseItem())).action).toBe(
      "create_shop_item",
    );
  });
});

describe("queue → publish flow", () => {
  test("queued changes publish as ONE message with one card per item", async () => {
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ price_hours: 20 })),
    });
    await queueShopItemChange({
      action: "create_shop_item",
      oldItem: null,
      newItem: asItem(baseItem({ id: 7, name: "Sticker" })),
    });

    expect((await publishPendingShopChanges()).published).toBe(2);
    expect(webhookMock).toHaveBeenCalledTimes(1);

    const [url, payload] = webhookMock.mock.calls[0]!;
    expect(url).toBe(WEBHOOK_URL);
    expect(payload.channel).toBeUndefined();
    expect(payload.text).toBeUndefined();
    expect(payload.unfurl_links).toBe(false);
    expect(
      findCarousel(payload.blocks as Array<Record<string, unknown>>)!.elements,
    ).toHaveLength(2);

    webhookMock.mockClear();
    expect((await publishPendingShopChanges()).published).toBe(0);
    expect(webhookMock).not.toHaveBeenCalled();
  });

  test("several saves of the same item collapse into one card", async () => {
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ price_hours: 20 })),
    });
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem({ price_hours: 20 })),
      newItem: asItem(baseItem({ price_hours: 20, name: "Pi 500" })),
    });

    expect((await publishPendingShopChanges()).published).toBe(1);
    const card = findCarousel(
      webhookMock.mock.calls[0]![1]!.blocks as Array<Record<string, unknown>>,
    )!.elements[0]!;
    expect(cardDiffText(card)).toContain("*Name:* ~Raspberry Pi 5~ → Pi 500");
    expect(cardDiffText(card)).toContain("*Price:* ~120 gold ($12)~ → 200 gold ($20)");
  });

  test("queueShopItemChange skips no-op updates", async () => {
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem()),
    });
    expect(await listPendingShopChanges()).toEqual([]);
    expect((await publishPendingShopChanges()).published).toBe(0);
    expect(webhookMock).not.toHaveBeenCalled();
  });

  test("listPendingShopChanges summarizes the merged queue", async () => {
    await queueShopItemChange({
      action: "archive_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ available: false })),
    });
    const summaries = await listPendingShopChanges();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.itemName).toBe("Raspberry Pi 5");
    expect(summaries[0]!.title).toBe("Shop item removed");
    expect(summaries[0]!.fields).toContain("Name");
  });

  test("publish throws when the webhook is unset and keeps the queue", async () => {
    runtimeConfig = { slackShopLogWebhookUrl: "" };
    await queueShopItemChange({
      action: "delete_shop_item",
      oldItem: asItem(baseItem()),
      newItem: null,
    });
    await expect(publishPendingShopChanges()).rejects.toThrow(
      "Shop log Slack webhook is not configured",
    );
    expect(await listPendingShopChanges()).toHaveLength(1);
  });

  test("retries with section blocks when carousel blocks are rejected", async () => {
    webhookMock.mockImplementationOnce(async () => ({
      ok: false,
      error: "invalid_blocks",
    }));
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ price_hours: 20 })),
    });

    expect((await publishPendingShopChanges()).published).toBe(1);
    expect(webhookMock).toHaveBeenCalledTimes(2);
    const retryBlocks = webhookMock.mock.calls[1]![1]!.blocks as Array<
      Record<string, unknown>
    >;
    expect(findCarousel(retryBlocks)).toBeUndefined();
    expect(retryBlocks.some((b) => b.type === "section")).toBe(true);
  });

  test("degrades on the webhook's invalid_payload rejection too", async () => {
    webhookMock.mockImplementationOnce(async () => ({
      ok: false,
      error: "invalid_payload",
    }));
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ price_hours: 20 })),
    });

    expect((await publishPendingShopChanges()).published).toBe(1);
    expect(webhookMock).toHaveBeenCalledTimes(2);
  });

  test("a rejected subtext card retries as a card before giving up on cards", async () => {
    webhookMock.mockImplementationOnce(async () => ({
      ok: false,
      error: "invalid_blocks",
    }));
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(
        baseItem({
          name: "Raspberry Pi 500",
          description: "A slightly larger tiny computer",
          price_hours: 20,
          sale_price_hours: 15,
          inventory_mode: "limited",
          stock_remaining: 25,
          max_per_user: 2,
          coming_soon: true,
          pinned: true,
          extra_fruity: true,
        }),
      ),
    });

    await publishPendingShopChanges();
    expect(webhookMock).toHaveBeenCalledTimes(2);

    expect(
      findCarousel(webhookMock.mock.calls[0]![1]!.blocks as Array<Record<string, unknown>>)!
        .elements[0]!.subtext,
    ).toBeDefined();
    expect(
      findCarousel(webhookMock.mock.calls[1]![1]!.blocks as Array<Record<string, unknown>>)!
        .elements[0]!.subtext,
    ).toBeUndefined();
  });

  test("publish throws on outright Slack failure and keeps the queue", async () => {
    webhookMock.mockImplementation(async () => ({
      ok: false,
      error: "channel_not_found",
    }));
    await queueShopItemChange({
      action: "update_shop_item",
      oldItem: asItem(baseItem()),
      newItem: asItem(baseItem({ price_hours: 20 })),
    });
    await expect(publishPendingShopChanges()).rejects.toThrow("channel_not_found");
    expect(await listPendingShopChanges()).toHaveLength(1);
  });
});
