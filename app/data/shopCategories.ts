// server/lib/shop-admin.ts validates against a hand-kept mirror of this list.
export const SHOP_ITEM_CATEGORIES = [
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

export type ShopItemCategory = (typeof SHOP_ITEM_CATEGORIES)[number];

// Internal admin editor only; the public shop localizes via shop_page.category.<key>.
export const SHOP_ITEM_CATEGORY_LABELS: Record<ShopItemCategory, string> = {
  tech: "Tech",
  food: "Food",
  gaming: "Gaming",
  apple: "Apple",
  merch: "Merch",
  grant: "Grant",
  event: "Event",
  consumable: "Consumable",
  printing: "3D Printing",
  tools: "Tools",
  other: "Other",
};

export function isShopItemCategory(value: unknown): value is ShopItemCategory {
  return (
    typeof value === "string" &&
    (SHOP_ITEM_CATEGORIES as readonly string[]).includes(value)
  );
}
