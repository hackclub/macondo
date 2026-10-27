import { describe, expect, test } from "bun:test";

import {
  optedOutCreditedRun,
  optedOutProjectStreakFromDays,
  reviewBridgeDaysForProject,
} from "./streak-helpers";

const TODAY = "2026-06-02";

function days(...d: string[]): Set<string> {
  return new Set(d);
}

const NONE = new Set<string>();

describe("optedOutProjectStreakFromDays", () => {
  test("continuous run ending today counts every day", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"),
        bridgedDays: NONE,
        floor: "2026-05-30",
        today: TODAY,
      }),
    ).toEqual({ streak: 4, lastWorked: "2026-06-02" });
  });

  test("today not yet worked but yesterday was => still live (in-flight grace)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-05-31", "2026-06-01"),
        bridgedDays: NONE,
        floor: "2026-05-31",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-06-01" });
  });

  test("idle one full day => resets to 0 (THE opted-out-dies-when-idle rule)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-05-29", "2026-05-30", "2026-05-31"),
        bridgedDays: NONE,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });

  test("interior gap before a live tail only counts the consecutive tail", () => {
    // The 05-29 gap killed the earlier run, so only the 4-day tail survives.
    const qualifying = days(
      "2026-05-28",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: qualifying,
        bridgedDays: NONE,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 4, lastWorked: "2026-06-02" });
  });

  test("review-protected day bridges a gap (holds run, does not count)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-05-31", "2026-06-02"),
        bridgedDays: days("2026-06-01"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-06-02" });
  });

  test("review-protected tail through today holds an idle-looking project", () => {
    // 05-31 predates yesterday, but the review bridge keeps the run alive to today.
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-05-30", "2026-05-31"),
        bridgedDays: days("2026-06-01", "2026-06-02"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-05-31" });
  });

  test("a run of only review-protected days (no qualifying work) is not a streak", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: NONE,
        bridgedDays: days("2026-05-31", "2026-06-01", "2026-06-02"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });

  test("run is clamped at the floor (no credit before project creation)", () => {
    const qualifying = days(
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: qualifying,
        bridgedDays: NONE,
        floor: "2026-05-31",
        today: TODAY,
      }),
    ).toEqual({ streak: 3, lastWorked: "2026-06-02" });
  });

  test("no qualifying days => 0 / null", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: NONE,
        bridgedDays: NONE,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });

  test("single qualifying day = today => streak 1", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-06-02"),
        bridgedDays: NONE,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 1, lastWorked: "2026-06-02" });
  });

  test("days after today are ignored (clock-skew safety)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-06-01", "2026-06-02", "2026-06-03"),
        bridgedDays: NONE,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-06-02" });
  });

  test("floor after today => 0 (degenerate window)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: days("2026-06-02"),
        bridgedDays: NONE,
        floor: "2026-06-10",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });
});

// Credit on top of a grandfathered stored streak whose run never actually broke.
describe("optedOutCreditedRun", () => {
  test("covered run since stored last_worked credits the new days", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: "2026-06-02",
        today: TODAY,
      }),
    ).toBe(23);
  });

  test("uncovered day between stored last_worked and today => no credit", () => {
    // 05-31 is a genuine break, so credit must not bridge it.
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-06-01", "2026-06-02"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: "2026-06-02",
        today: TODAY,
      }),
    ).toBe(0);
  });

  test("review bridge covers the in-between day", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-06-02"),
        bridgedDays: days("2026-05-31", "2026-06-01"),
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: "2026-06-02",
        today: TODAY,
      }),
    ).toBe(21);
  });

  test("today in flight (not yet qualifying) still credits through yesterday", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-05-31", "2026-06-01"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: "2026-06-01",
        today: TODAY,
      }),
    ).toBe(22);
  });

  test("no qualifying days after stored last_worked => 0 (hold, not stored)", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-05-30"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: "2026-05-30",
        today: "2026-05-31",
      }),
    ).toBe(0);
  });

  test("null stored last_worked or dead run => 0", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-06-02"),
        bridgedDays: NONE,
        storedStreak: 0,
        storedLastWorked: null,
        runLastWorked: "2026-06-02",
        today: TODAY,
      }),
    ).toBe(0);
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-05-30"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-30",
        runLastWorked: null,
        today: TODAY,
      }),
    ).toBe(0);
  });

  test("qualifying days past today are ignored (clock-skew safety)", () => {
    expect(
      optedOutCreditedRun({
        qualifyingDays: days("2026-06-01", "2026-06-02", "2026-06-03"),
        bridgedDays: NONE,
        storedStreak: 20,
        storedLastWorked: "2026-05-31",
        runLastWorked: "2026-06-02",
        today: TODAY,
      }),
    ).toBe(22);
  });
});

function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Ship-row windows keep a review decision from turning the queue wait into an idle gap.
describe("reviewBridgeDaysForProject", () => {
  const baseShip = {
    inReviewLoop: false,
    queueEnteredAt: null as Date | null,
    createdAt: null as Date | null,
    reviewedAt: null as Date | null,
    projectStreakDaysAtSubmission: null as number | null,
    projectLastWorkedDateAtSubmission: null as string | null,
  };

  test("decided ship with alive snapshot bridges from the day after last work through the decision day", () => {
    expect(
      reviewBridgeDaysForProject({
        ships: [
          {
            ...baseShip,
            reviewedAt: new Date("2026-06-01T12:00:00Z"),
            projectStreakDaysAtSubmission: 5,
            projectLastWorkedDateAtSubmission: "2026-05-28",
          },
        ],
        tz: "UTC",
        floor: "2026-05-01",
        today: "2026-06-02",
      }),
    ).toEqual(days("2026-05-29", "2026-05-30", "2026-05-31", "2026-06-01"));
  });

  test("open window (review loop, no reviewed_at) runs to today; dead snapshot falls back to queue-entry day", () => {
    expect(
      reviewBridgeDaysForProject({
        ships: [
          {
            ...baseShip,
            inReviewLoop: true,
            queueEnteredAt: new Date("2026-05-30T10:00:00Z"),
            projectStreakDaysAtSubmission: 0,
          },
        ],
        tz: "UTC",
        floor: "2026-05-01",
        today: "2026-06-02",
      }),
    ).toEqual(days("2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"));
  });

  test("terminal row with no reviewed_at close edge is skipped (would be unwiltable)", () => {
    expect(
      reviewBridgeDaysForProject({
        ships: [
          {
            ...baseShip,
            queueEnteredAt: new Date("2026-05-30T10:00:00Z"),
          },
        ],
        tz: "UTC",
        floor: "2026-05-01",
        today: "2026-06-02",
      }),
    ).toEqual(NONE);
  });

  test("implausibly long span is skipped (ops-stamped reviewed_at on an ancient row)", () => {
    expect(
      reviewBridgeDaysForProject({
        ships: [
          {
            ...baseShip,
            reviewedAt: new Date("2026-06-01T12:00:00Z"),
            projectStreakDaysAtSubmission: 10,
            projectLastWorkedDateAtSubmission: "2026-01-01",
          },
        ],
        tz: "UTC",
        floor: "2025-12-01",
        today: "2026-06-02",
      }),
    ).toEqual(NONE);
  });

  test("window is clamped to the walk floor and today", () => {
    expect(
      reviewBridgeDaysForProject({
        ships: [
          {
            ...baseShip,
            reviewedAt: new Date("2026-06-05T12:00:00Z"),
            projectStreakDaysAtSubmission: 3,
            projectLastWorkedDateAtSubmission: "2026-05-28",
          },
        ],
        tz: "UTC",
        floor: "2026-05-31",
        today: "2026-06-02",
      }),
    ).toEqual(days("2026-05-31", "2026-06-01", "2026-06-02"));
  });
});

// Replays project 2445: a 53-day plant whose maker worked other projects during the queue wait;
// the old walk wilted it 53 -> 0 right after approval.
describe("approved-ship window keeps an opted-out plant alive (project 2445 shape)", () => {
  const TZ = "Europe/London";
  const FLOOR = "2026-06-03";
  const qualifying = new Set(dayRange("2026-06-03", "2026-07-25"));
  // Resubmitted after a withdraw, so the snapshot spans the deleted predecessor's window too.
  const ships = [
    {
      inReviewLoop: false,
      queueEnteredAt: new Date("2026-07-29T19:46:12Z"),
      createdAt: new Date("2026-07-29T19:46:12Z"),
      reviewedAt: new Date("2026-08-05T23:21:12Z"),
      projectStreakDaysAtSubmission: 53,
      projectLastWorkedDateAtSubmission: "2026-07-25",
    },
  ];

  function bridge(today: string): Set<string> {
    return reviewBridgeDaysForProject({ ships, tz: TZ, floor: FLOOR, today });
  }

  test("sync right after approval holds the 53 instead of wilting", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: qualifying,
        bridgedDays: bridge("2026-08-06"),
        floor: FLOOR,
        today: "2026-08-06",
      }),
    ).toEqual({ streak: 53, lastWorked: "2026-07-25" });
  });

  test("still held through the full grace day after the close", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: qualifying,
        bridgedDays: bridge("2026-08-07"),
        floor: FLOOR,
        today: "2026-08-07",
      }),
    ).toEqual({ streak: 53, lastWorked: "2026-07-25" });
  });

  test("watering the plant on the decision day reconnects and grows the run", () => {
    const watered = new Set(qualifying);
    watered.add("2026-08-06");
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: watered,
        bridgedDays: bridge("2026-08-06"),
        floor: FLOOR,
        today: "2026-08-06",
      }),
    ).toEqual({ streak: 54, lastWorked: "2026-08-06" });
    // The credited-run path agrees: stored 53 + 1 new day.
    expect(
      optedOutCreditedRun({
        qualifyingDays: watered,
        bridgedDays: bridge("2026-08-06"),
        storedStreak: 53,
        storedLastWorked: "2026-07-25",
        runLastWorked: "2026-08-06",
        today: "2026-08-06",
      }),
    ).toBe(54);
  });

  test("a genuinely idle day after the grace still wilts (the decision is not immortality)", () => {
    expect(
      optedOutProjectStreakFromDays({
        qualifyingDays: qualifying,
        bridgedDays: bridge("2026-08-08"),
        floor: FLOOR,
        today: "2026-08-08",
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });
});
