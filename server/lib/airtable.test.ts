// Imports from cross-ysws-dedup.ts so the test loads without server/db's Nuxt `#imports` alias.

import { describe, expect, test } from "bun:test";

import {
  computeHackatimeBasedDeduction,
  computeUpdateShipDelta,
  pickLatestInWindowApprovalDate,
  sumCreditedInWindowHours,
  type UnifiedYswsMatch,
} from "./cross-ysws-dedup";

function match(overrides: Partial<UnifiedYswsMatch> = {}): UnifiedYswsMatch {
  return {
    recordId: overrides.recordId ?? "rec",
    ysws: overrides.ysws ?? "Horizons",
    url: overrides.url ?? "https://github.com/x/y",
    field: overrides.field ?? "Code URL",
    hours: overrides.hours ?? 0,
    firstSubmittedAt: overrides.firstSubmittedAt ?? null,
    inWindow: overrides.inWindow ?? true,
  };
}

describe("computeUpdateShipDelta", () => {
  test("first ship pushes the full cumulative", () => {
    expect(
      computeUpdateShipDelta({
        isUpdateShip: false,
        currentOverrideHours: 5,
        previousOverrideHours: 0,
        currentSoftwareOverrideHours: 0,
        previousSoftwareOverrideHours: 0,
      }),
    ).toBe(5);
  });

  test("project 1439 regression: deflated software update pushes new work, not 0", () => {
    // A cumulative diff would push max(0, 1.25 - 1.4) = 0; software hours are per-update.
    expect(
      computeUpdateShipDelta({
        isUpdateShip: true,
        currentOverrideHours: 1.25,
        previousOverrideHours: 1.4,
        currentSoftwareOverrideHours: 1.25,
        previousSoftwareOverrideHours: 1.4,
      }),
    ).toBeCloseTo(1.25, 5);
  });

  test("hardware update diffs cumulative journal hours (no software portion)", () => {
    // Journal hours are cumulative, so the new work is 2.0h - 1.4h = 0.6h.
    expect(
      computeUpdateShipDelta({
        isUpdateShip: true,
        currentOverrideHours: 2.0,
        previousOverrideHours: 1.4,
        currentSoftwareOverrideHours: 0,
        previousSoftwareOverrideHours: 0,
      }),
    ).toBeCloseTo(0.6, 5);
  });

  test("mixed ship: cumulative journal diff plus per-update software", () => {
    // Journal portion unchanged at 0.5h, so only the per-update 0.8h software is pushed.
    expect(
      computeUpdateShipDelta({
        isUpdateShip: true,
        currentOverrideHours: 1.3,
        previousOverrideHours: 1.5,
        currentSoftwareOverrideHours: 0.8,
        previousSoftwareOverrideHours: 1.0,
      }),
    ).toBeCloseTo(0.8, 5);
  });

  test("journal hours dropping between ships never pushes a negative delta", () => {
    // e.g. a journal archived on re-review
    expect(
      computeUpdateShipDelta({
        isUpdateShip: true,
        currentOverrideHours: 0.5,
        previousOverrideHours: 2.0,
        currentSoftwareOverrideHours: 0.5,
        previousSoftwareOverrideHours: 0,
      }),
    ).toBeCloseTo(0.5, 5);
  });
});

describe("pickLatestInWindowApprovalDate", () => {
  test("empty match list returns null", () => {
    expect(pickLatestInWindowApprovalDate([])).toBeNull();
  });

  test("all pre-window matches return null even when dated", () => {
    const result = pickLatestInWindowApprovalDate([
      match({
        inWindow: false,
        firstSubmittedAt: new Date("2026-04-01T00:00:00Z"),
      }),
      match({
        inWindow: false,
        firstSubmittedAt: new Date("2026-04-10T00:00:00Z"),
      }),
    ]);
    expect(result).toBeNull();
  });

  test("mixed in-window and pre-window: only in-window dates are eligible", () => {
    const inWindow = new Date("2026-04-22T00:00:00Z");
    const preWindowLater = new Date("2026-05-01T00:00:00Z");
    const result = pickLatestInWindowApprovalDate([
      match({ inWindow: false, firstSubmittedAt: preWindowLater }),
      match({ inWindow: true, firstSubmittedAt: inWindow }),
    ]);
    expect(result?.toISOString()).toBe(inWindow.toISOString());
  });

  test("multiple in-window matches return the latest", () => {
    const earlier = new Date("2026-04-22T00:00:00Z");
    const latest = new Date("2026-04-29T00:00:00Z");
    const result = pickLatestInWindowApprovalDate([
      match({ recordId: "a", firstSubmittedAt: earlier }),
      match({ recordId: "b", firstSubmittedAt: latest }),
    ]);
    expect(result?.toISOString()).toBe(latest.toISOString());
  });

  test("in-window match without firstSubmittedAt is skipped", () => {
    const dated = new Date("2026-04-22T00:00:00Z");
    const result = pickLatestInWindowApprovalDate([
      match({ recordId: "a", firstSubmittedAt: null }),
      match({ recordId: "b", firstSubmittedAt: dated }),
    ]);
    expect(result?.toISOString()).toBe(dated.toISOString());
  });
});

describe("sumCreditedInWindowHours", () => {
  test("empty list sums to zero", () => {
    expect(sumCreditedInWindowHours([])).toBe(0);
  });

  test("only in-window matches contribute", () => {
    const result = sumCreditedInWindowHours([
      match({ inWindow: true, hours: 5.1 }),
      match({ inWindow: true, hours: 2.3 }),
      match({ inWindow: false, hours: 100 }),
    ]);
    expect(result).toBeCloseTo(7.4, 5);
  });

  test("non-finite hours contribute zero", () => {
    const result = sumCreditedInWindowHours([
      match({ inWindow: true, hours: Number.NaN }),
      match({ inWindow: true, hours: 3 }),
    ]);
    expect(result).toBe(3);
  });

  test("single in-window match contributes its credited hours", () => {
    expect(
      sumCreditedInWindowHours([match({ inWindow: true, hours: 0.42 })]),
    ).toBeCloseTo(0.42, 5);
  });
});

describe("computeHackatimeBasedDeduction", () => {
  test("normal case: pre-cutoff work is deducted", () => {
    // 30h total, 18h since the latest other-YSWS approval, so 12h predates it.
    expect(computeHackatimeBasedDeduction(30, 18)).toBe(12);
  });

  test("zero work pre-cutoff: total === sinceLatest returns 0", () => {
    expect(computeHackatimeBasedDeduction(15, 15)).toBe(0);
  });

  test("sinceLatest exceeds total (impossible from API): clamp to 0", () => {
    expect(computeHackatimeBasedDeduction(10, 25)).toBe(0);
  });

  test("both inputs zero: deduction is 0", () => {
    expect(computeHackatimeBasedDeduction(0, 0)).toBe(0);
  });

  test("non-finite total: deduction is 0", () => {
    expect(computeHackatimeBasedDeduction(Number.NaN, 5)).toBe(0);
    expect(computeHackatimeBasedDeduction(Number.POSITIVE_INFINITY, 5)).toBe(0);
  });

  test("non-finite sinceLatest: deduction is 0", () => {
    expect(computeHackatimeBasedDeduction(20, Number.NaN)).toBe(0);
  });
});
