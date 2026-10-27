// Runs on blur: mobile users clear the field to retype, so a per-keystroke reset made it uneditable.
export function clampPurchaseQuantity(raw: unknown, max: number): number {
  const cap = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(Math.floor(value), cap);
}
