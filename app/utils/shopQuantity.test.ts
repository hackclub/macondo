// Regression guard: a per-keystroke reset to 1 made the field uneditable on mobile keypads.

import { describe, expect, test } from "bun:test";

import { clampPurchaseQuantity } from "./shopQuantity";

describe("clampPurchaseQuantity", () => {
  test("an empty field normalizes to 1", () => {
    expect(clampPurchaseQuantity("", 999)).toBe(1);
  });

  test("the intended quantity of 2 is preserved", () => {
    expect(clampPurchaseQuantity(2, 999)).toBe(2);
  });

  test("a valid two-digit quantity under the cap is preserved", () => {
    expect(clampPurchaseQuantity(12, 999)).toBe(12);
  });

  test("a quantity above the cap clamps to the cap", () => {
    expect(clampPurchaseQuantity(50, 3)).toBe(3);
  });

  test("zero and negatives normalize to 1", () => {
    expect(clampPurchaseQuantity(0, 999)).toBe(1);
    expect(clampPurchaseQuantity(-4, 999)).toBe(1);
  });

  test("fractional input is floored", () => {
    expect(clampPurchaseQuantity(2.9, 999)).toBe(2);
  });

  test("NaN normalizes to 1", () => {
    expect(clampPurchaseQuantity(Number.NaN, 999)).toBe(1);
  });

  test("a non-positive cap still yields at least 1", () => {
    expect(clampPurchaseQuantity(5, 0)).toBe(1);
  });
});
