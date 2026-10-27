import { describe, expect, test } from "bun:test";

import { syncLastActiveCandidate } from "./streak-helpers";

const TODAY = "2026-07-09";
const YESTERDAY = "2026-07-08";

describe("syncLastActiveCandidate", () => {
  test("yesterday-only work yields yesterday, never today (the ticket case)", () => {
    // must stay yesterday so the reconcile gap-walk still reaches (and freezes) today
    expect(syncLastActiveCandidate(null, YESTERDAY, TODAY, YESTERDAY)).toBe(
      YESTERDAY,
    );
  });

  test("work today yields today", () => {
    expect(syncLastActiveCandidate(null, TODAY, TODAY, YESTERDAY)).toBe(TODAY);
  });

  test("older backfill work does not move the anchor", () => {
    expect(syncLastActiveCandidate(null, "2026-07-01", TODAY, YESTERDAY)).toBe(
      null,
    );
  });

  test("null newLastWorked (wilted / never worked) keeps the previous candidate", () => {
    expect(syncLastActiveCandidate(YESTERDAY, null, TODAY, YESTERDAY)).toBe(
      YESTERDAY,
    );
  });

  test("multi-project fold keeps the newest work day", () => {
    const afterA = syncLastActiveCandidate(null, YESTERDAY, TODAY, YESTERDAY);
    expect(syncLastActiveCandidate(afterA, TODAY, TODAY, YESTERDAY)).toBe(TODAY);
    const afterB = syncLastActiveCandidate(null, TODAY, TODAY, YESTERDAY);
    expect(syncLastActiveCandidate(afterB, YESTERDAY, TODAY, YESTERDAY)).toBe(
      TODAY,
    );
  });
});
