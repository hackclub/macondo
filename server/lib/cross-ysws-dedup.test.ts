// Self (Macondo) matches must never enter the hours/deduction/cutoff math, or payouts would be deflated.

import { describe, expect, test } from "bun:test";

import {
  pickLatestInWindowApprovalDate,
  shipCountsAsUnifiedUpdate,
  sumCreditedInWindowHours,
  type UnifiedYswsMatch,
} from "./cross-ysws-dedup";

function match(overrides: Partial<UnifiedYswsMatch>): UnifiedYswsMatch {
  return {
    recordId: "rec0",
    ysws: "Highway",
    url: "https://github.com/x/y",
    field: "Code URL",
    hours: 0,
    firstSubmittedAt: null,
    inWindow: true,
    ...overrides,
  };
}

describe("sumCreditedInWindowHours", () => {
  test("sums in-window, non-self matches", () => {
    expect(
      sumCreditedInWindowHours([
        match({ recordId: "a", hours: 5, inWindow: true }),
        match({ recordId: "b", hours: 3, inWindow: true }),
      ]),
    ).toBe(8);
  });

  test("ignores pre-window matches", () => {
    expect(
      sumCreditedInWindowHours([
        match({ recordId: "a", hours: 5, inWindow: true }),
        match({ recordId: "b", hours: 99, inWindow: false }),
      ]),
    ).toBe(5);
  });

  test("ignores self (Macondo) matches even when in-window", () => {
    expect(
      sumCreditedInWindowHours([
        match({ recordId: "a", hours: 5, inWindow: true }),
        match({
          recordId: "self",
          ysws: "Macondo",
          hours: 10,
          inWindow: true,
          isSelf: true,
        }),
      ]),
    ).toBe(5);
  });

  test("a list of only self matches contributes zero", () => {
    expect(
      sumCreditedInWindowHours([
        match({ recordId: "s1", ysws: "Macondo", hours: 12, isSelf: true }),
        match({ recordId: "s2", ysws: "Macondo", hours: 8, isSelf: true }),
      ]),
    ).toBe(0);
  });

  test("adding a self match does not change the sum", () => {
    const base = [match({ recordId: "a", hours: 7, inWindow: true })];
    const withSelf = [
      ...base,
      match({
        recordId: "self",
        ysws: "Macondo",
        hours: 50,
        inWindow: true,
        isSelf: true,
      }),
    ];
    expect(sumCreditedInWindowHours(withSelf)).toBe(
      sumCreditedInWindowHours(base),
    );
  });
});

describe("pickLatestInWindowApprovalDate", () => {
  const early = new Date("2026-05-01T00:00:00Z");
  const late = new Date("2026-05-10T00:00:00Z");

  test("picks the latest in-window, non-self approval date", () => {
    expect(
      pickLatestInWindowApprovalDate([
        match({ recordId: "a", inWindow: true, firstSubmittedAt: early }),
        match({ recordId: "b", inWindow: true, firstSubmittedAt: late }),
      ])?.getTime(),
    ).toBe(late.getTime());
  });

  test("ignores a self match even when it is the latest date", () => {
    expect(
      pickLatestInWindowApprovalDate([
        match({ recordId: "a", inWindow: true, firstSubmittedAt: early }),
        match({
          recordId: "self",
          ysws: "Macondo",
          inWindow: true,
          firstSubmittedAt: late,
          isSelf: true,
        }),
      ])?.getTime(),
    ).toBe(early.getTime());
  });

  test("returns null when only self matches are present", () => {
    expect(
      pickLatestInWindowApprovalDate([
        match({
          recordId: "self",
          ysws: "Macondo",
          inWindow: true,
          firstSubmittedAt: late,
          isSelf: true,
        }),
      ]),
    ).toBeNull();
  });

  test("adding a later self match does not move the cutoff", () => {
    const base = [
      match({ recordId: "a", inWindow: true, firstSubmittedAt: early }),
    ];
    const withSelf = [
      ...base,
      match({
        recordId: "self",
        ysws: "Macondo",
        inWindow: true,
        firstSubmittedAt: late,
        isSelf: true,
      }),
    ];
    expect(pickLatestInWindowApprovalDate(withSelf)?.getTime()).toBe(
      pickLatestInWindowApprovalDate(base)?.getTime(),
    );
  });
});

describe("shipCountsAsUnifiedUpdate", () => {
  test("true when the project already has a prior shipped Macondo ship", () => {
    expect(
      shipCountsAsUnifiedUpdate({
        hasPriorShippedMacondoShip: true,
        unifiedMatchCount: 0,
      }),
    ).toBe(true);
  });

  test("true on a FIRST Macondo ship that has a unified-DB match (Isometric Island)", () => {
    expect(
      shipCountsAsUnifiedUpdate({
        hasPriorShippedMacondoShip: false,
        unifiedMatchCount: 1,
      }),
    ).toBe(true);
  });

  test("false on a genuinely fresh first ship with no unified match", () => {
    expect(
      shipCountsAsUnifiedUpdate({
        hasPriorShippedMacondoShip: false,
        unifiedMatchCount: 0,
      }),
    ).toBe(false);
  });

  test("true when both a prior Macondo ship AND a unified match exist", () => {
    expect(
      shipCountsAsUnifiedUpdate({
        hasPriorShippedMacondoShip: true,
        unifiedMatchCount: 2,
      }),
    ).toBe(true);
  });
});
