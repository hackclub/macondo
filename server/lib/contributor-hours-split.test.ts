// Invariant: shares sum exactly to the pushed total, so a group ship never over- or underpays vs a solo row.

import { describe, expect, test } from "bun:test";

import {
  splitGoldByHours,
  splitPushedHours,
  type ContributorWeight,
} from "./contributor-hours-split";

function c(
  userId: string,
  approvedHours: number | null,
  hackatimeHours: number | null = null,
): ContributorWeight {
  return {
    user_id: userId,
    approved_hours: approvedHours,
    hackatime_hours: hackatimeHours,
  };
}

const sum = (shares: Array<{ hours: number }>) =>
  Math.round(shares.reduce((a, s) => a + s.hours, 0) * 100) / 100;

describe("splitPushedHours", () => {
  test("weights by approved hours and conserves the total", () => {
    expect(splitPushedHours([c("owner", 6), c("mate", 2)], 20, "owner")).toEqual([
      { user_id: "owner", hours: 15 },
      { user_id: "mate", hours: 5 },
    ]);
  });

  test("falls back to hackatime hours when no approved split exists", () => {
    expect(
      splitPushedHours([c("owner", null, 1), c("mate", null, 3)], 10, "owner"),
    ).toEqual([
      { user_id: "owner", hours: 2.5 },
      { user_id: "mate", hours: 7.5 },
    ]);
  });

  test("splits evenly when neither source has signal", () => {
    const shares = splitPushedHours([c("owner", 0), c("mate", null)], 9, "owner");
    expect(sum(shares)).toBe(9);
    expect(shares[1]!.hours).toBe(4.5);
  });

  test("rounding residual lands on the owner row", () => {
    const shares = splitPushedHours(
      [c("owner", 1), c("a", 1), c("b", 1)],
      10,
      "owner",
    );
    expect(sum(shares)).toBe(10);
    expect(shares[0]!.user_id).toBe("owner");
  });

  test("owner sorts first even when listed last", () => {
    expect(
      splitPushedHours([c("mate", 1), c("owner", 1)], 4, "owner")[0]!.user_id,
    ).toBe("owner");
  });

  test("a non-positive pushed total yields zero shares, never negatives", () => {
    expect(splitPushedHours([c("owner", 5), c("mate", 5)], -3, "owner")).toEqual([
      { user_id: "owner", hours: 0 },
      { user_id: "mate", hours: 0 },
    ]);
  });

  test("no contributors yields no rows", () => {
    expect(splitPushedHours([], 10, "owner")).toEqual([]);
  });
});

describe("splitGoldByHours", () => {
  const h = (userId: string, hours: number) => ({ user_id: userId, hours });
  const total = (shares: Array<{ amount: number }>) => shares.reduce((a, s) => a + s.amount, 0);

  test("splits gold and approved hours by each contributor's hours", () => {
    expect(splitGoldByHours([h("mate", 10), h("owner", 30)], 400, 20, "owner")).toEqual([
      { user_id: "owner", amount: 300, hours: 15 },
      { user_id: "mate", amount: 100, hours: 5 },
    ]);
  });

  test("a contributor with no hours gets nothing, the rest get everything", () => {
    expect(splitGoldByHours([h("owner", 12), h("mate", 0)], 250, 12, "owner")).toEqual([
      { user_id: "owner", amount: 250, hours: 12 },
      { user_id: "mate", amount: 0, hours: 0 },
    ]);
  });

  test("the last contributor absorbs the rounding so the slices sum to the reward", () => {
    const shares = splitGoldByHours([h("owner", 1), h("a", 1), h("b", 1)], 100, 9, "owner");
    expect(shares.map((s) => s.amount)).toEqual([33, 33, 34]);
    expect(total(shares)).toBe(100);
  });

  test("splits evenly when nobody has hours", () => {
    const shares = splitGoldByHours([h("owner", 0), h("a", 0), h("b", 0)], 100, 9, "owner");
    expect(shares.map((s) => s.amount)).toEqual([34, 33, 33]);
    expect(shares.map((s) => s.hours)).toEqual([3, 3, 3]);
  });

  test("a ship with no contributor rows pays its owner", () => {
    expect(splitGoldByHours([], 80, 4, "owner")).toEqual([{ user_id: "owner", amount: 80, hours: 4 }]);
  });
});
