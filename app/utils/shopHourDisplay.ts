// Display ratio is 50 gold = 1 hour, distinct from the server's GOLD_PER_HOUR earn rate.
export type ShopTimeDisplay = {
  unit: "hours" | "minutes";
  count: number;
};

export function shopHourDisplay(priceGold: number): ShopTimeDisplay {
  if (!Number.isFinite(priceGold) || priceGold <= 0) {
    return { unit: "hours", count: 0 };
  }
  const hours = priceGold / 50;
  if (hours >= 1) {
    return { unit: "hours", count: Math.round(hours) };
  }
  return { unit: "minutes", count: Math.max(1, Math.round(hours * 60)) };
}
