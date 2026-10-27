import { describe, expect, test } from "bun:test";

import { freezeRefundedNotification, planFreezeRefund } from "./streak-helpers";

const HOUR = 3600;

describe("planFreezeRefund", () => {
  test("frozen day that now qualifies via hackatime refunds a freeze and flips active", () => {
    const got = planFreezeRefund({
      currentStatus: "frozen",
      liveSeconds: HOUR + 100,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 2,
      threshold: HOUR,
    });
    expect(got.flip).toBe(true);
    expect(got.newFreezes).toBe(3);
    expect(got.refunded).toBe(true);
    expect(got.recoveredSeconds).toBe(HOUR + 100);
  });

  test("refund is capped at maxFreezes: still flips, no increment", () => {
    const got = planFreezeRefund({
      currentStatus: "frozen",
      liveSeconds: HOUR + 400,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 5,
      threshold: HOUR,
      maxFreezes: 5,
    });
    expect(got.flip).toBe(true);
    expect(got.newFreezes).toBe(5);
    expect(got.refunded).toBe(false);
  });

  test("frozen day still below threshold is left untouched", () => {
    const got = planFreezeRefund({
      currentStatus: "frozen",
      liveSeconds: HOUR - 600,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 1,
      threshold: HOUR,
    });
    expect(got.flip).toBe(false);
    expect(got.newFreezes).toBe(1);
    expect(got.refunded).toBe(false);
  });

  test("qualifies via combined hackatime + journal (not hackatime alone)", () => {
    // 40 min hackatime + 30 min journal = 70 min; a hackatime-only check would miss this.
    const got = planFreezeRefund({
      currentStatus: "frozen",
      liveSeconds: 40 * 60,
      storedSeconds: 0,
      journalSeconds: 30 * 60,
      freezesRemaining: 0,
      threshold: HOUR,
    });
    expect(got.flip).toBe(true);
    expect(got.newFreezes).toBe(1);
    expect(got.refunded).toBe(true);
  });

  test("stored high-water mark qualifies even when live regressed", () => {
    const got = planFreezeRefund({
      currentStatus: "frozen",
      liveSeconds: 1200,
      storedSeconds: HOUR + 100,
      journalSeconds: 0,
      freezesRemaining: 1,
      threshold: HOUR,
    });
    expect(got.flip).toBe(true);
    expect(got.recoveredSeconds).toBe(HOUR + 100);
    expect(got.refunded).toBe(true);
  });

  test("missed day is terminal and never refunded", () => {
    const got = planFreezeRefund({
      currentStatus: "missed",
      liveSeconds: 2 * HOUR,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 1,
      threshold: HOUR,
    });
    expect(got.flip).toBe(false);
    expect(got.newFreezes).toBe(1);
    expect(got.refunded).toBe(false);
  });

  test("already-active day is a no-op", () => {
    const got = planFreezeRefund({
      currentStatus: "active",
      liveSeconds: 2 * HOUR,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 1,
      threshold: HOUR,
    });
    expect(got.flip).toBe(false);
    expect(got.refunded).toBe(false);
  });

  test("review_protected day is a no-op", () => {
    const got = planFreezeRefund({
      currentStatus: "review_protected",
      liveSeconds: 2 * HOUR,
      storedSeconds: 0,
      journalSeconds: 0,
      freezesRemaining: 1,
      threshold: HOUR,
    });
    expect(got.flip).toBe(false);
    expect(got.refunded).toBe(false);
  });
});

describe("freezeRefundedNotification", () => {
  test("single refunded day names the day and the new balance", () => {
    const got = freezeRefundedNotification({
      days: ["2026-08-09"],
      refundedCount: 1,
      freezesLeft: 5,
    });
    expect(got.title).toBe("Streak freeze refunded");
    expect(got.body).toContain("2026-08-09 counts toward your streak");
    expect(got.body).toContain("gave back 1 streak freeze");
    expect(got.body).toContain("5 streak freezes left");
  });

  test("multiple days pluralize both the days and the refund", () => {
    const got = freezeRefundedNotification({
      days: ["2026-08-09", "2026-08-10"],
      refundedCount: 2,
      freezesLeft: 1,
    });
    expect(got.title).toBe("Streak freezes refunded");
    expect(got.body).toContain("2026-08-09, 2026-08-10 count toward");
    expect(got.body).toContain("gave back 2 streak freezes");
    expect(got.body).toContain("1 streak freeze left");
  });

  test("wallet at the cap still notifies but promises no freeze back", () => {
    const got = freezeRefundedNotification({
      days: ["2026-08-09"],
      refundedCount: 0,
      freezesLeft: 5,
    });
    expect(got.body).toContain("counts toward your streak");
    expect(got.body).not.toContain("gave back");
    expect(got.body).toContain("already full");
  });
});
