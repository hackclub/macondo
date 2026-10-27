// Amounts can be fractional; truncate (never round up) so a 20.59 balance reads "20.5".
export function formatGold(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "0";
  const truncated = Math.trunc(amount * 10) / 10;
  if (Number.isInteger(truncated)) return String(truncated);
  return truncated.toFixed(1);
}

// 12470 → "12.47k": two decimals keep shop prices at 10-gold precision.
export function formatGoldCompact(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "0";
  const abs = Math.abs(amount);
  if (abs < 1000) return formatGold(amount);
  if (abs < 1_000_000) {
    return `${trimNum(amount / 1000)}k`;
  }
  if (abs < 1_000_000_000) {
    return `${trimNum(amount / 1_000_000)}M`;
  }
  return `${trimNum(amount / 1_000_000_000)}B`;
}

function trimNum(n: number): string {
  // String() already drops trailing decimal zeros; a /\.?0+$/ strip would turn 20 into 2.
  return String(Math.round(n * 100) / 100);
}
