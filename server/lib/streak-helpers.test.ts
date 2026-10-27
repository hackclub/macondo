import { describe, expect, test } from "bun:test";

import {
  HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
  HACKATIME_STREAK_DAY_SECONDS,
  currentStreakLengthFromDays,
  dashboardStreak,
  dayInTz,
  dayQualifiesForProjectStreak,
  dayQualifiesForUserStreak,
  effectiveHackatimeNamesByProject,
  effectiveStreakDaysForShip,
  mergedGapSumSeconds,
  nextMonotonicHackatimeSeconds,
  pendingDaysToRequalify,
  planStrandedFreezeBackfill,
  projectDayCountsForStreak,
  projectMultiplierForRun,
  recomputeWalkFloor,
  resolveRecomputedStreak,
  streakDayKey,
  unreliableDaysAfterTruncation,
} from "./streak-helpers";

describe("HACKATIME_STREAK_DAY_SECONDS", () => {
  test("is exactly one hour", () => {
    expect(HACKATIME_STREAK_DAY_SECONDS).toBe(3600);
  });
});

describe("mergedGapSumSeconds", () => {
  const beats = (...times: number[]) => times.map((time) => ({ time }));

  test("merging interleaved projects counts each second once, not per project", () => {
    // Bouncing between two projects on a 30s cadence: per-project sums count cross-project gaps twice.
    const a = beats(0, 60, 120);
    const b = beats(30, 90, 150);
    const merged = mergedGapSumSeconds([...a, ...b]);

    expect(mergedGapSumSeconds(a)).toBe(120);
    expect(mergedGapSumSeconds(b)).toBe(120);
    expect(merged).toBe(150);
    expect(merged).toBeLessThan(mergedGapSumSeconds(a) + mergedGapSumSeconds(b)); // 240 per-project sum, the bug
  });

  test("a gap above the timeout credits exactly the timeout (Hackatime LEAST rule)", () => {
    // 0 -> 60 counts in full, the 1-hour break credits exactly the timeout, then +60.
    expect(mergedGapSumSeconds(beats(0, 60, 60 + 3600, 60 + 3600 + 60))).toBe(
      120 + HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
    );
  });

  test("a gap exactly at the timeout is counted in full (inclusive bound)", () => {
    expect(
      mergedGapSumSeconds(beats(0, HACKATIME_HEARTBEAT_TIMEOUT_SECONDS)),
    ).toBe(HACKATIME_HEARTBEAT_TIMEOUT_SECONDS);
  });

  test("gaps between the timeout and 10 minutes are capped, not counted in full", () => {
    // The old rule added gaps <= 600s in full; Hackatime caps each at 2 minutes, so 4 * 120, not 4 * 300.
    expect(mergedGapSumSeconds(beats(0, 300, 600, 900, 1200))).toBe(
      4 * HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
    );
  });

  test("mixed stream matches Hackatime's LEAST(gap, timeout) sum exactly", () => {
    // 90s (full) + 300s (capped 120) + 4000s (capped 120) + 30s (full).
    expect(mergedGapSumSeconds(beats(0, 90, 390, 4390, 4420))).toBe(90 + 120 + 120 + 30);
  });

  test("the final beat of the stream earns no trailing pad", () => {
    // Nothing follows the last beat, so 0 -> 60 is 60, not 60 plus a phantom timeout.
    expect(mergedGapSumSeconds(beats(0, 60))).toBe(60);
  });

  test("a lone beat followed by a long break earns exactly the timeout", () => {
    // The 1-hour break credits min(3600, timeout) = 120s; the final beat adds nothing.
    expect(mergedGapSumSeconds(beats(0, 3600))).toBe(
      HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
    );
  });

  test("single-name user: the merged path degenerates to the plain stream (reporter shape)", () => {
    // Overlapping chunk fetches can duplicate beats; the total must equal the plain stream.
    const stream = beats(0, 60, 200, 700, 760);
    expect(mergedGapSumSeconds([...stream, ...beats(200, 700)])).toBe(
      mergedGapSumSeconds(stream),
    );
    expect(mergedGapSumSeconds(stream)).toBe(360);
  });

  test("duplicate-timestamp beats contribute a zero gap (overlapping chunks safe)", () => {
    expect(mergedGapSumSeconds(beats(0, 0, 60, 60, 120))).toBe(120);
  });

  test("unsorted input is handled (caller need not pre-sort)", () => {
    expect(mergedGapSumSeconds(beats(120, 0, 60))).toBe(120);
  });

  test("a single project's interleaved names merge to wall-clock, not the sum", () => {
    const nameX = beats(0, 60, 120);
    const nameY = beats(30, 90);
    expect(mergedGapSumSeconds([...nameX, ...nameY])).toBe(120);
    expect(mergedGapSumSeconds([...nameX, ...nameY])).toBeLessThan(
      mergedGapSumSeconds(nameX) + mergedGapSumSeconds(nameY),
    );
  });

  test("fewer than two beats is zero", () => {
    expect(mergedGapSumSeconds([])).toBe(0);
    expect(mergedGapSumSeconds(beats(42))).toBe(0);
  });
});

describe("streakDayKey", () => {
  test("returns the UTC YYYY-MM-DD for the given instant", () => {
    expect(streakDayKey(new Date("2026-05-28T03:18:44.945Z"))).toBe(
      "2026-05-28",
    );
  });

  test("treats the same instant the same in every timezone", () => {
    // Without a tz the key is the UTC day, even when the local day differs.
    const nineteenThirtyCdtMay28 = new Date("2026-05-29T00:30:00.000Z");
    expect(streakDayKey(nineteenThirtyCdtMay28)).toBe("2026-05-29");
    expect(dayInTz(nineteenThirtyCdtMay28, "America/Chicago")).toBe(
      "2026-05-28",
    );
  });

  test("UTC midnight boundary lands on the new day", () => {
    expect(streakDayKey(new Date("2026-05-28T00:00:00.000Z"))).toBe(
      "2026-05-28",
    );
    expect(streakDayKey(new Date("2026-05-27T23:59:59.999Z"))).toBe(
      "2026-05-27",
    );
  });

  test("default arg uses current time", () => {
    const before = new Date();
    const key = streakDayKey();
    const after = new Date();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      key === streakDayKey(before) || key === streakDayKey(after),
    ).toBe(true);
  });

  test("returns local YYYY-MM-DD when tz arg is provided", () => {
    // 00:30 UTC May 29 = 19:30 CDT May 28 in Chicago.
    const t = new Date("2026-05-29T00:30:00.000Z");
    expect(streakDayKey(t, "America/Chicago")).toBe("2026-05-28");
    expect(streakDayKey(t, "UTC")).toBe("2026-05-29");
    expect(streakDayKey(t)).toBe("2026-05-29"); // no tz falls back to UTC
  });

  test("null / undefined tz falls back to UTC", () => {
    const t = new Date("2026-05-29T00:30:00.000Z");
    expect(streakDayKey(t, null)).toBe("2026-05-29");
    expect(streakDayKey(t, undefined)).toBe("2026-05-29");
  });

  test("local midnight boundary lands on the new local day in user's tz", () => {
    // May 29 in New York is EDT (UTC-4), so 04:00 UTC = 00:00 EDT.
    expect(
      streakDayKey(new Date("2026-05-29T03:59:59.000Z"), "America/New_York"),
    ).toBe("2026-05-28");
    expect(
      streakDayKey(new Date("2026-05-29T04:00:00.000Z"), "America/New_York"),
    ).toBe("2026-05-29");
  });

  test("DST spring-forward: 02:30 EST jumps to 03:30 EDT, same local day", () => {
    expect(
      streakDayKey(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"), // 02:30 EST / 03:30 EDT
    ).toBe("2026-03-08");
  });

  test("DST fall-back: ambiguous 01:30 instances both resolve to the same local day", () => {
    expect(
      streakDayKey(new Date("2026-11-01T05:30:00.000Z"), "America/New_York"), // 01:30 EDT
    ).toBe("2026-11-01");
    expect(
      streakDayKey(new Date("2026-11-01T06:30:00.000Z"), "America/New_York"), // 01:30 EST
    ).toBe("2026-11-01");
  });

  test("invalid tz string falls back to UTC", () => {
    expect(
      streakDayKey(new Date("2026-05-29T00:30:00.000Z"), "Not/A/Real/Zone"),
    ).toBe("2026-05-29");
  });

  test("UTC-anchor loophole: 6 PM CDT and 8 PM CDT same evening land in different UTC days", () => {
    const sixPmCdtMay28 = new Date("2026-05-28T23:00:00.000Z");
    const eightPmCdtMay28 = new Date("2026-05-29T01:00:00.000Z");
    const midnightCdtMay29 = new Date("2026-05-29T05:00:00.000Z");

    expect(dayInTz(sixPmCdtMay28, "America/Chicago")).toBe("2026-05-28");
    expect(dayInTz(eightPmCdtMay28, "America/Chicago")).toBe("2026-05-28");
    expect(dayInTz(midnightCdtMay29, "America/Chicago")).toBe("2026-05-29");

    // UTC labels flip mid-evening because UTC midnight = 7 PM CDT.
    expect(streakDayKey(sixPmCdtMay28)).toBe("2026-05-28");
    expect(streakDayKey(eightPmCdtMay28)).toBe("2026-05-29");
    expect(streakDayKey(midnightCdtMay29)).toBe("2026-05-29");
  });
});

describe("dayQualifiesForProjectStreak", () => {
  test("journal alone qualifies when its seconds reach the floor", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: 3600,
      }),
    ).toBe(true);
  });

  test("0-hour journal alone does NOT qualify (the project 1964 bug)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });

  test("half-hour journal plus half-hour live hackatime qualifies (combined-sum rule)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 1800,
        storedSeconds: 0,
        journalSeconds: 1800,
      }),
    ).toBe(true);
  });

  test("half-hour journal plus half-hour stored hackatime qualifies (combined-sum rule)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 1800,
        journalSeconds: 1800,
      }),
    ).toBe(true);
  });

  test("live hackatime over the floor qualifies with no journal", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 3600,
        storedSeconds: 0,
        journalSeconds: 0,
      }),
    ).toBe(true);
  });

  test("stored hackatime over the floor qualifies even when live regressed", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 200,
        storedSeconds: 4158,
        journalSeconds: 0,
      }),
    ).toBe(true);
  });

  test("hackatime takes max(live, stored) before adding journal", () => {
    // live and stored are the same hackatime contribution, so they're maxed, not summed.
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 1800,
        storedSeconds: 1800,
        journalSeconds: 1800,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 1800,
        storedSeconds: 1800,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });

  test("nothing qualifies when all signals are below threshold", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 200,
        storedSeconds: 263,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });

  test("exactly hits the threshold", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: HACKATIME_STREAK_DAY_SECONDS,
        storedSeconds: 0,
        journalSeconds: 0,
      }),
    ).toBe(true);
  });

  test("custom threshold parameter overrides default", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 1000,
        storedSeconds: 0,
        journalSeconds: 0,
        threshold: 500,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 1000,
        storedSeconds: 0,
        journalSeconds: 0,
        threshold: 5000,
      }),
    ).toBe(false);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 200,
        storedSeconds: 0,
        journalSeconds: 400,
        threshold: 500,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: 500,
        threshold: 500,
      }),
    ).toBe(true);
  });

  test("NaN / negative inputs treated as zero", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: Number.NaN,
        storedSeconds: -100,
        journalSeconds: -50,
      }),
    ).toBe(false);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: Number.NaN,
        storedSeconds: 5000,
        journalSeconds: Number.NaN,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: Number.NaN,
        storedSeconds: Number.NaN,
        journalSeconds: 5000,
      }),
    ).toBe(true);
  });
});

describe("dayQualifiesForUserStreak", () => {
  test("the 2026-05-28 reported bug: 550s hackatime + 0-hour journal does NOT qualify", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 550,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });

  test("0-hour journal alone does NOT qualify", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 0,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });

  test("1-hour journal alone qualifies", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 0,
        journalSeconds: 3600,
      }),
    ).toBe(true);
  });

  test("1-hour hackatime alone qualifies", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 3600,
        journalSeconds: 0,
      }),
    ).toBe(true);
  });

  test("half-hour hackatime plus half-hour journal qualifies (combined-sum rule)", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 1800,
        journalSeconds: 1800,
      }),
    ).toBe(true);
  });

  test("exactly hits the threshold", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: HACKATIME_STREAK_DAY_SECONDS,
        journalSeconds: 0,
      }),
    ).toBe(true);
  });

  test("custom threshold parameter overrides default", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 200,
        journalSeconds: 400,
        threshold: 500,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 0,
        journalSeconds: 500,
        threshold: 500,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: 200,
        journalSeconds: 400,
        threshold: 1000,
      }),
    ).toBe(false);
  });

  test("NaN / negative inputs treated as zero", () => {
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: Number.NaN,
        journalSeconds: -100,
      }),
    ).toBe(false);
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: -200,
        journalSeconds: 5000,
      }),
    ).toBe(true);
    expect(
      dayQualifiesForUserStreak({
        hackatimeSeconds: Number.POSITIVE_INFINITY,
        journalSeconds: 0,
      }),
    ).toBe(false);
  });
});

describe("nextMonotonicHackatimeSeconds", () => {
  test("incoming higher than existing wins", () => {
    expect(nextMonotonicHackatimeSeconds(1000, 5000)).toBe(5000);
  });

  test("existing higher than incoming wins (the regression-protection case)", () => {
    expect(nextMonotonicHackatimeSeconds(4158, 263)).toBe(4158);
  });

  test("equal values produce a stable result", () => {
    expect(nextMonotonicHackatimeSeconds(3600, 3600)).toBe(3600);
  });

  test("zero incoming preserves existing", () => {
    // Explicit zeroing must not route through this helper.
    expect(nextMonotonicHackatimeSeconds(7200, 0)).toBe(7200);
  });

  test("zero existing accepts incoming", () => {
    expect(nextMonotonicHackatimeSeconds(0, 1500)).toBe(1500);
  });

  test("both zero produces zero", () => {
    expect(nextMonotonicHackatimeSeconds(0, 0)).toBe(0);
  });

  test("non-finite inputs treated as zero", () => {
    expect(nextMonotonicHackatimeSeconds(Number.NaN, 1000)).toBe(1000);
    expect(nextMonotonicHackatimeSeconds(1000, Number.NaN)).toBe(1000);
    expect(nextMonotonicHackatimeSeconds(Number.NaN, Number.NaN)).toBe(0);
    expect(nextMonotonicHackatimeSeconds(Number.POSITIVE_INFINITY, 0)).toBe(0);
  });

  test("negative inputs clamped to zero", () => {
    expect(nextMonotonicHackatimeSeconds(-50, 100)).toBe(100);
    expect(nextMonotonicHackatimeSeconds(100, -50)).toBe(100);
    expect(nextMonotonicHackatimeSeconds(-50, -100)).toBe(0);
  });

  test("fractional inputs are floored", () => {
    expect(nextMonotonicHackatimeSeconds(0, 1500.9)).toBe(1500);
    expect(nextMonotonicHackatimeSeconds(1500.9, 0)).toBe(1500);
  });
});

describe("effectiveStreakDaysForShip", () => {
  test("null snapshot falls back to live streak", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: null, liveStreakDays: 7 }),
    ).toBe(7);
  });

  test("undefined snapshot falls back to live streak", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: undefined, liveStreakDays: 7 }),
    ).toBe(7);
  });

  test("snapshot greater than live wins (review-queue protection)", () => {
    // Shipped at a 10-day streak, then broke it in the queue; the multiplier keeps the 10.
    expect(
      effectiveStreakDaysForShip({ snapshot: 10, liveStreakDays: 0 }),
    ).toBe(10);
  });

  test("live greater than snapshot wins (continued work during review)", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: 0, liveStreakDays: 14 }),
    ).toBe(14);
  });

  test("equal snapshot and live", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: 5, liveStreakDays: 5 }),
    ).toBe(5);
  });

  test("both zero produces zero", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: 0, liveStreakDays: 0 }),
    ).toBe(0);
  });

  test("negative snapshot clamped to zero", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: -5, liveStreakDays: 3 }),
    ).toBe(3);
  });

  test("negative live clamped to zero", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: 4, liveStreakDays: -10 }),
    ).toBe(4);
  });

  test("both negative produce zero", () => {
    expect(
      effectiveStreakDaysForShip({ snapshot: -5, liveStreakDays: -3 }),
    ).toBe(0);
  });

  test("non-finite inputs treated as zero", () => {
    expect(
      effectiveStreakDaysForShip({
        snapshot: Number.NaN,
        liveStreakDays: 5,
      }),
    ).toBe(5);
    expect(
      effectiveStreakDaysForShip({
        snapshot: 5,
        liveStreakDays: Number.NaN,
      }),
    ).toBe(5);
    expect(
      effectiveStreakDaysForShip({
        snapshot: Number.POSITIVE_INFINITY,
        liveStreakDays: 0,
      }),
    ).toBe(0);
  });
});

describe("projectMultiplierForRun", () => {
  test("grandfathers a streak that started before the rollout", () => {
    expect(
      projectMultiplierForRun({
        projectStreakDays: 100,
        lastWorkedDate: "2026-07-10",
        level: 3,
      }),
    ).toBe(2);
  });

  test("caps a brand new L3 streak run at 1.7x", () => {
    expect(
      projectMultiplierForRun({
        projectStreakDays: 100,
        lastWorkedDate: "2026-10-09",
        level: 3,
      }),
    ).toBeCloseTo(1.7, 2);
  });

  test("an old streak that breaks and restarts falls under the new cap", () => {
    expect(
      projectMultiplierForRun({
        projectStreakDays: 71,
        lastWorkedDate: "2026-09-10",
        level: 3,
      }),
    ).toBeCloseTo(1.7, 2);
  });

  test("caps brand new L2 and L4 runs at their level ceilings", () => {
    expect(
      projectMultiplierForRun({
        projectStreakDays: 100,
        lastWorkedDate: "2026-12-31",
        level: 2,
      }),
    ).toBeCloseTo(1.88, 2);
    expect(
      projectMultiplierForRun({
        projectStreakDays: 60,
        lastWorkedDate: "2026-12-31",
        level: 4,
      }),
    ).toBeCloseTo(1.41, 2);
  });

  test("leaves brand new L1 at the old 2x max", () => {
    expect(
      projectMultiplierForRun({
        projectStreakDays: 100,
        lastWorkedDate: "2026-12-31",
        level: 1,
      }),
    ).toBeCloseTo(2, 2);
  });
});

describe("resolveRecomputedStreak", () => {
  test("credits a qualifying day stranded after last_worked when the from-floor count did not rise (flameX / project 3108)", () => {
    // 05-29 settled 4s under 1h, so the from-floor count stays 4 while 05-31 is a real qualifying day.
    expect(
      resolveRecomputedStreak({
        storedStreak: 4,
        storedLastWorked: "2026-05-30",
        recomputed: 4,
        recomputedLastWorked: "2026-05-31",
        strandedAfterLastWorked: 1,
      }),
    ).toEqual({ streak: 5, lastWorked: "2026-05-31" });
  });

  test("credits the stranded day on a long streak without recomputing from floor (Baton / project 1136, 30 -> 31)", () => {
    expect(
      resolveRecomputedStreak({
        storedStreak: 30,
        storedLastWorked: "2026-05-30",
        recomputed: 29,
        recomputedLastWorked: "2026-05-31",
        strandedAfterLastWorked: 1,
      }),
    ).toEqual({ streak: 31, lastWorked: "2026-05-31" });
  });

  test("never strips: a lower from-floor count with no newer qualifying day leaves the streak untouched (2026-05-30 incident guard)", () => {
    // Nothing is stranded, so hold at 30; a blind recompute once nuked 698 streaks.
    expect(
      resolveRecomputedStreak({
        storedStreak: 30,
        storedLastWorked: "2026-05-30",
        recomputed: 29,
        recomputedLastWorked: "2026-05-30",
        strandedAfterLastWorked: 0,
      }),
    ).toEqual({ streak: 30, lastWorked: "2026-05-30" });
  });

  test("heal path unchanged: when the from-floor count exceeds the stored streak, the recompute wins outright", () => {
    // recomputed (15) > stored (10), so the recompute wins, not stored + stranded (12).
    expect(
      resolveRecomputedStreak({
        storedStreak: 10,
        storedLastWorked: "2026-05-20",
        recomputed: 15,
        recomputedLastWorked: "2026-05-22",
        strandedAfterLastWorked: 2,
      }),
    ).toEqual({ streak: 15, lastWorked: "2026-05-22" });
  });

  test("null last_worked rebuild path unchanged (a reset project rebuilds from floor)", () => {
    // strandedAfterLastWorked is 0 by construction when last_worked is null.
    expect(
      resolveRecomputedStreak({
        storedStreak: 0,
        storedLastWorked: null,
        recomputed: 7,
        recomputedLastWorked: "2026-05-31",
        strandedAfterLastWorked: 0,
      }),
    ).toEqual({ streak: 7, lastWorked: "2026-05-31" });
  });

  test("no-op when nothing changed (already at the newest qualifying day)", () => {
    expect(
      resolveRecomputedStreak({
        storedStreak: 5,
        storedLastWorked: "2026-05-31",
        recomputed: 5,
        recomputedLastWorked: "2026-05-31",
        strandedAfterLastWorked: 0,
      }),
    ).toEqual({ streak: 5, lastWorked: "2026-05-31" });
  });

  test("credits multiple stranded days across a freeze-covered gap", () => {
    // 05-29 was a freeze-covered gap; 05-30 and 05-31 qualified, so +2.
    expect(
      resolveRecomputedStreak({
        storedStreak: 7,
        storedLastWorked: "2026-05-28",
        recomputed: 7,
        recomputedLastWorked: "2026-05-31",
        strandedAfterLastWorked: 2,
      }),
    ).toEqual({ streak: 9, lastWorked: "2026-05-31" });
  });
});

describe("recomputeWalkFloor", () => {
  test("no missed day: the floor stays at the project floor", () => {
    expect(
      recomputeWalkFloor({ projectFloor: "2026-04-30", lastMissedDay: null }),
    ).toBe("2026-04-30");
  });

  test("a missed day after the project floor bounds the floor to the day after the break", () => {
    // A reset writes a missed day; recounting across it would resurrect a stored-0 project.
    expect(
      recomputeWalkFloor({
        projectFloor: "2026-04-21",
        lastMissedDay: "2026-05-28",
      }),
    ).toBe("2026-05-29");
  });

  test("a missed day before the project floor leaves the project floor unchanged", () => {
    // The day after the miss (04-02) is still below the project floor.
    expect(
      recomputeWalkFloor({
        projectFloor: "2026-05-10",
        lastMissedDay: "2026-04-01",
      }),
    ).toBe("2026-05-10");
  });

  test("a missed day equal to the project floor advances one day", () => {
    expect(
      recomputeWalkFloor({
        projectFloor: "2026-05-10",
        lastMissedDay: "2026-05-10",
      }),
    ).toBe("2026-05-11");
  });

  test("crosses a month boundary correctly", () => {
    expect(
      recomputeWalkFloor({
        projectFloor: "2026-01-01",
        lastMissedDay: "2026-05-31",
      }),
    ).toBe("2026-06-01");
  });
});

describe("unreliableDaysAfterTruncation", () => {
  const allDays: string[] = [];
  for (
    let d = new Date("2026-05-08T00:00:00Z");
    d <= new Date("2026-06-06T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    allDays.push(d.toISOString().slice(0, 10));
  }

  test("not truncated: nothing is unreliable", () => {
    expect(
      unreliableDaysAfterTruncation({
        truncated: false,
        allDays,
        newestCoveredDay: "2026-05-22",
      }),
    ).toEqual([]);
  });

  test("truncated: flags the newest covered day and everything after it", () => {
    // The cap ran out at 05-22, so that partial day and everything after it is unreliable.
    const out = unreliableDaysAfterTruncation({
      truncated: true,
      allDays,
      newestCoveredDay: "2026-05-22",
    });
    expect(out[0]).toBe("2026-05-22");
    expect(out.at(-1)).toBe("2026-06-06");
    expect(out).toContain("2026-06-03");
    expect(out).toContain("2026-06-04");
    expect(out).toContain("2026-06-05");
    expect(out).not.toContain("2026-05-21");
    expect(out).not.toContain("2026-05-08");
  });

  test("truncated with no in-window beats: every day is unreliable", () => {
    expect(
      unreliableDaysAfterTruncation({
        truncated: true,
        allDays,
        newestCoveredDay: null,
      }),
    ).toEqual(allDays);
  });

  test("truncated right up to today: only today is unreliable", () => {
    expect(
      unreliableDaysAfterTruncation({
        truncated: true,
        allDays,
        newestCoveredDay: "2026-06-06",
      }),
    ).toEqual(["2026-06-06"]);
  });
});

describe("planStrandedFreezeBackfill", () => {
  test("the proven case: a near-miss hole between kept days is frozen", () => {
    // 06-04 (55m near-miss) was stranded when 06-05 requalified and advanced last_active past it.
    const statusByDay = new Map<string, string>([
      ["2026-06-02", "active"],
      ["2026-06-03", "frozen"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
      ["2026-06-06", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-07",
        freezesAvailable: 4,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: ["2026-06-04"], unresolvedNoFreeze: [] });
  });

  test("no freeze available: the hole is left unresolved (pending), not frozen", () => {
    // Interior hole, so this tests the no-freeze branch rather than the leading-edge exclusion.
    const statusByDay = new Map<string, string>([
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 0,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: ["2026-06-04"] });
  });

  test("canBurn false (opted out / no protectable project): never burns", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 5,
        canBurn: false,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: ["2026-06-04"] });
  });

  test("all-or-nothing: two holes but only one freeze burns nothing", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "pending"],
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 1,
        canBurn: true,
      }),
    ).toEqual({
      freezeDays: [],
      unresolvedNoFreeze: ["2026-06-02", "2026-06-04"],
    });
  });

  test("two holes with two freezes: both bridged", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "pending"],
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 2,
        canBurn: true,
      }),
    ).toEqual({
      freezeDays: ["2026-06-02", "2026-06-04"],
      unresolvedNoFreeze: [],
    });
  });

  test("a later missed day means the run already broke: pending is not a hole", () => {
    // Freezing 06-03 buys nothing because the run ends at the 06-04 miss anyway.
    const statusByDay = new Map<string, string>([
      ["2026-06-03", "pending"],
      ["2026-06-04", "missed"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("trailing frontier pending (no later kept day) is left to the normal reconcile", () => {
    // The frontier belongs to the gap-walk, not the sweep.
    const statusByDay = new Map<string, string>([
      ["2026-06-04", "active"],
      ["2026-06-05", "pending"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("today pending is never healed even with a kept day already today-adjacent", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-05", "active"],
      ["2026-06-06", "pending"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("review_protected counts as a later kept day (bridges a hole)", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-02", "active"],
      ["2026-06-03", "pending"],
      ["2026-06-04", "review_protected"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 2,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: ["2026-06-03"], unresolvedNoFreeze: [] });
  });

  test("leading near-miss (no earlier kept day) is NOT bridged", () => {
    // 06-07 is a 37m near-miss backfilled from pre-signup history; the streak simply begins at 06-08.
    const statusByDay = new Map<string, string>([
      ["2026-06-07", "pending"],
      ["2026-06-08", "active"],
      ["2026-06-09", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-10",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("leading edge of a NEW run after a break is not bridged", () => {
    // 06-03 follows the 06-02 break, so it starts the new run rather than being an interior hole.
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "missed"],
      ["2026-06-03", "pending"],
      ["2026-06-04", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-05",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("interior hole in a run that follows an earlier break IS bridged", () => {
    // The earlier missed only bounds the prior segment; 06-04 is anchored by 06-03 and 06-05.
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "missed"],
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: ["2026-06-04"], unresolvedNoFreeze: [] });
  });

  test("end-to-end: bridging the stranded hole restores the day-run", () => {
    const statusByDay = new Map<string, string>();
    for (
      let d = new Date("2026-05-16T00:00:00Z");
      d <= new Date("2026-06-06T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      statusByDay.set(d.toISOString().slice(0, 10), "active");
    }
    statusByDay.set("2026-06-03", "frozen");
    statusByDay.set("2026-06-04", "pending");
    const today = "2026-06-07";
    const windowStart = "2026-05-01";

    // Before: the pending hole at 06-04 truncates the run at 06-05/06-06.
    expect(
      currentStreakLengthFromDays({ statusByDay, today, windowStart }),
    ).toBe(2);

    const plan = planStrandedFreezeBackfill({
      statusByDay,
      today,
      freezesAvailable: 4,
      canBurn: true,
    });
    expect(plan.freezeDays).toEqual(["2026-06-04"]);

    for (const d of plan.freezeDays) statusByDay.set(d, "frozen");
    expect(
      currentStreakLengthFromDays({ statusByDay, today, windowStart }),
    ).toBe(22);
  });

  test("a calendar GAP before the later kept day is a break: pre-project backfilled near-misses are NOT bridged", () => {
    // 06-01..03 is pre-project history cut off from the live run by a no-row gap, so it must not be bridged.
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "pending"],
      ["2026-06-03", "pending"],
      // 2026-06-04 / 05 / 06: NO ROW (calendar gap == break)
      ["2026-06-07", "active"],
      ["2026-06-08", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-09",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("a calendar GAP before the hole makes it a leading edge (not bridged)", () => {
    const statusByDay = new Map<string, string>([
      ["2026-05-30", "active"],
      // 2026-05-31 / 06-01: NO ROW (calendar gap == break)
      ["2026-06-02", "pending"],
      ["2026-06-03", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-04",
        freezesAvailable: 5,
        canBurn: true,
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("holes before earliestPlantDay are never bridged, even between kept days", () => {
    // 06-30 abuts the live run with no gap but predates the first project, so it's not even unresolved.
    const statusByDay = new Map<string, string>([
      ["2026-06-26", "active"],
      ["2026-06-27", "active"],
      ["2026-06-28", "active"],
      ["2026-06-29", "active"],
      ["2026-06-30", "pending"],
      ["2026-07-01", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-07-02",
        freezesAvailable: 5,
        canBurn: true,
        earliestPlantDay: "2026-07-01",
      }),
    ).toEqual({ freezeDays: [], unresolvedNoFreeze: [] });
  });

  test("holes on or after earliestPlantDay still bridge normally", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 2,
        canBurn: true,
        earliestPlantDay: "2026-06-04",
      }),
    ).toEqual({ freezeDays: ["2026-06-04"], unresolvedNoFreeze: [] });
  });

  test("null earliestPlantDay skips the pre-project guard (back-compat)", () => {
    const statusByDay = new Map<string, string>([
      ["2026-06-03", "active"],
      ["2026-06-04", "pending"],
      ["2026-06-05", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-06",
        freezesAvailable: 2,
        canBurn: true,
        earliestPlantDay: null,
      }),
    ).toEqual({ freezeDays: ["2026-06-04"], unresolvedNoFreeze: [] });
  });

  test("mixed: pre-floor hole excluded while a post-floor hole bridges", () => {
    // The pre-floor 06-02 must not eat the all-or-nothing budget, so 06-06 still bridges with one freeze.
    const statusByDay = new Map<string, string>([
      ["2026-06-01", "active"],
      ["2026-06-02", "pending"],
      ["2026-06-03", "active"],
      ["2026-06-04", "active"],
      ["2026-06-05", "active"],
      ["2026-06-06", "pending"],
      ["2026-06-07", "active"],
    ]);
    expect(
      planStrandedFreezeBackfill({
        statusByDay,
        today: "2026-06-08",
        freezesAvailable: 1,
        canBurn: true,
        earliestPlantDay: "2026-06-03",
      }),
    ).toEqual({ freezeDays: ["2026-06-06"], unresolvedNoFreeze: [] });
  });
});

describe("dashboardStreak", () => {
  test("floors the headline streak at the best project streak", () => {
    expect(dashboardStreak({ streakDaysRun: 0, maxProjectStreak: 32 })).toBe(32);
  });

  test("keeps the streak_days run when it exceeds every project streak", () => {
    expect(dashboardStreak({ streakDaysRun: 15, maxProjectStreak: 10 })).toBe(
      15,
    );
  });

  test("null max project streak (no projects) falls back to the run", () => {
    expect(dashboardStreak({ streakDaysRun: 5, maxProjectStreak: null })).toBe(
      5,
    );
  });

  test("both zero produces zero", () => {
    expect(dashboardStreak({ streakDaysRun: 0, maxProjectStreak: 0 })).toBe(0);
  });

  test("negative / non-finite inputs are treated as zero", () => {
    expect(
      dashboardStreak({ streakDaysRun: -3, maxProjectStreak: Number.NaN }),
    ).toBe(0);
    expect(
      dashboardStreak({ streakDaysRun: Number.NaN, maxProjectStreak: 7 }),
    ).toBe(7);
  });

  test("review floor holds the headline during an open review window", () => {
    // The run fell to 18, but the user was at 23 when their ship entered the queue.
    expect(
      dashboardStreak({
        streakDaysRun: 18,
        maxProjectStreak: 7,
        reviewFloor: 23,
      }),
    ).toBe(23);
  });

  test("review floor below the run is a no-op", () => {
    expect(
      dashboardStreak({
        streakDaysRun: 20,
        maxProjectStreak: 5,
        reviewFloor: 12,
      }),
    ).toBe(20);
  });

  test("omitted or null review floor preserves prior behavior", () => {
    expect(dashboardStreak({ streakDaysRun: 9, maxProjectStreak: 4 })).toBe(9);
    expect(
      dashboardStreak({
        streakDaysRun: 9,
        maxProjectStreak: 4,
        reviewFloor: null,
      }),
    ).toBe(9);
  });

  test("non-finite or negative review floor is treated as zero", () => {
    expect(
      dashboardStreak({
        streakDaysRun: 0,
        maxProjectStreak: 0,
        reviewFloor: Number.NaN,
      }),
    ).toBe(0);
    expect(
      dashboardStreak({
        streakDaysRun: 0,
        maxProjectStreak: 0,
        reviewFloor: -5,
      }),
    ).toBe(0);
  });
});

describe("currentStreakLengthFromDays", () => {
  const mk = (entries: Array<[string, string]>) => new Map(entries);
  const WS = "2026-01-01";

  test("counts a plain run of active days ending today", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "active"],
      ["2026-06-01", "active"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(3);
  });

  test("review_protected days hold the run but do not grow it while a ship is in review", () => {
    // 3 days of work, then 2 review days: the headline holds at 3.
    const m = mk([
      ["2026-05-28", "active"],
      ["2026-05-29", "active"],
      ["2026-05-30", "active"],
      ["2026-05-31", "review_protected"],
      ["2026-06-01", "review_protected"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(3);
  });

  test("leading review days (today in review) hold the displayed run without extending it", () => {
    const m = mk([
      ["2026-05-27", "active"],
      ["2026-05-28", "active"],
      ["2026-05-29", "review_protected"],
      ["2026-05-30", "review_protected"],
      ["2026-05-31", "review_protected"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-05-31", windowStart: WS }),
    ).toBe(2);
  });

  test("review days bridge a gap: work on both sides counts, queue days do not", () => {
    const m = mk([
      ["2026-05-28", "active"], // counts
      ["2026-05-29", "review_protected"], // bridges, no count
      ["2026-05-30", "review_protected"], // bridges, no count
      ["2026-05-31", "active"], // counts
      ["2026-06-01", "active"], // counts
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(3);
  });

  test("review_protected behind an active anchor bridges without counting (ship-in-review shape)", () => {
    const m = mk([
      ["2026-05-27", "active"],
      ["2026-05-28", "active"],
      ["2026-05-29", "active"],
      ["2026-05-30", "review_protected"],
      ["2026-05-31", "review_protected"],
      ["2026-06-01", "review_protected"],
    ]);
    // Today 06-02 has no row, so the walk starts at 06-01.
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-02", windowStart: WS }),
    ).toBe(3);
  });

  test("frozen days still count toward the length", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "frozen"],
      ["2026-06-01", "active"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(3);
  });

  test("a run made entirely of review_protected days is 0 (a streak must be founded on real work)", () => {
    const m = mk([
      ["2026-05-31", "review_protected"],
      ["2026-06-01", "review_protected"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(0);
  });

  test("today pending starts the walk at yesterday", () => {
    const m = mk([
      ["2026-05-31", "active"],
      ["2026-06-01", "pending"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(1);
  });

  test("today missed is a hard break (0)", () => {
    const m = mk([
      ["2026-05-31", "active"],
      ["2026-06-01", "missed"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(0);
  });

  // todayQualifiedLive counts today once it cleared the 1h floor, before the sync flips its row.
  test("today pending + qualified live counts today immediately", () => {
    const m = mk([
      ["2026-05-31", "active"],
      ["2026-06-01", "pending"],
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: true,
      }),
    ).toBe(2);
  });

  test("today with no row + qualified live counts today (journal saved pre-sync)", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "active"],
      // no row for 2026-06-01 yet, but it qualified live
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: true,
      }),
    ).toBe(3);
  });

  test("qualified live never overrides an explicit missed today (still 0)", () => {
    const m = mk([
      ["2026-05-31", "active"],
      ["2026-06-01", "missed"],
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: true,
      }),
    ).toBe(0);
  });

  test("qualified live does not double-count a today whose row is already active", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "active"],
      ["2026-06-01", "active"],
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: true,
      }),
    ).toBe(3);
  });

  test("live today above a broken yesterday counts only today (no resurrection)", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "missed"],
      // today 2026-06-01 has no row yet but qualified live
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: true,
      }),
    ).toBe(1);
  });

  test("todayQualifiedLive defaults off: a pending today still walks from yesterday", () => {
    const m = mk([
      ["2026-05-31", "active"],
      ["2026-06-01", "pending"],
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: WS,
        todayQualifiedLive: false,
      }),
    ).toBe(1);
  });

  test("the first non-kept day going backwards ends the run", () => {
    const m = mk([
      ["2026-05-29", "active"],
      ["2026-05-30", "missed"],
      ["2026-05-31", "active"],
      ["2026-06-01", "active"],
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-01", windowStart: WS }),
    ).toBe(2);
  });

  test("respects windowStart as a hard floor", () => {
    const m = mk([
      ["2026-05-30", "active"],
      ["2026-05-31", "active"],
      ["2026-06-01", "active"],
    ]);
    expect(
      currentStreakLengthFromDays({
        statusByDay: m,
        today: "2026-06-01",
        windowStart: "2026-06-01",
      }),
    ).toBe(1);
  });

  // Reconcile lags far-east-of-UTC local days, so a bounded run of no-row trailing days must read
  // as pending, not broken.
  test("tolerates a 1-day unreconciled trailing gap above a review_protected anchor (Darsh shape)", () => {
    const m = mk([
      ["2026-06-14", "active"],
      ["2026-06-15", "active"],
      ["2026-06-16", "review_protected"],
      ["2026-06-17", "review_protected"],
      ["2026-06-18", "review_protected"],
      // 2026-06-19 not yet reconciled (no row); today 06-20 also roomless.
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-20", windowStart: WS }),
    ).toBe(2);
  });

  test("tolerates a 2-day unreconciled trailing gap (one skipped reconcile cycle)", () => {
    const m = mk([
      ["2026-06-14", "active"],
      ["2026-06-15", "active"],
      ["2026-06-16", "frozen"],
      // 06-17 and 06-18 both unreconciled; today 06-19 roomless.
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-19", windowStart: WS }),
    ).toBe(3);
  });

  test("does NOT resurrect a long-dead streak past the reconcile-lag grace", () => {
    // Beyond the grace the trailing gap is a real break, not reconcile lag.
    const m = mk([
      ["2026-06-10", "active"],
      ["2026-06-11", "active"],
      // wide roomless gap up to today 06-18
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-18", windowStart: WS }),
    ).toBe(0);
  });

  test("an explicit missed at the reconcile frontier still breaks (0)", () => {
    const m = mk([
      ["2026-06-14", "active"],
      ["2026-06-15", "active"],
      ["2026-06-16", "missed"],
      // today 06-18, 06-17 unreconciled; the frontier row 06-16 is a real break.
    ]);
    expect(
      currentStreakLengthFromDays({ statusByDay: m, today: "2026-06-18", windowStart: WS }),
    ).toBe(0);
  });
});

describe("pendingDaysToRequalify", () => {
  const TH = 3600;

  test("promotes a pending day whose combined seconds now meet threshold", () => {
    expect(
      pendingDaysToRequalify(
        [{ day: "2026-05-23", status: "pending", hackatimeSeconds: 0, journalSeconds: 7200 }],
        TH,
      ),
    ).toEqual(["2026-05-23"]);
  });

  test("counts hackatime + journal combined, not either alone", () => {
    expect(
      pendingDaysToRequalify(
        [{ day: "d", status: "pending", hackatimeSeconds: 1800, journalSeconds: 1800 }],
        TH,
      ),
    ).toEqual(["d"]);
  });

  test("leaves a pending day still below threshold alone", () => {
    expect(
      pendingDaysToRequalify(
        [{ day: "d", status: "pending", hackatimeSeconds: 1000, journalSeconds: 2000 }],
        TH,
      ),
    ).toEqual([]);
  });

  test("never touches active, frozen, missed, or review_protected days", () => {
    const rows = [
      { day: "a", status: "active", hackatimeSeconds: 9999, journalSeconds: 9999 },
      { day: "f", status: "frozen", hackatimeSeconds: 9999, journalSeconds: 9999 },
      { day: "m", status: "missed", hackatimeSeconds: 9999, journalSeconds: 9999 },
      { day: "r", status: "review_protected", hackatimeSeconds: 9999, journalSeconds: 9999 },
    ];
    expect(pendingDaysToRequalify(rows, TH)).toEqual([]);
  });

  test("returns only the qualifying pending days from a mixed batch", () => {
    const rows = [
      { day: "2026-05-12", status: "pending", hackatimeSeconds: 0, journalSeconds: 7200 },
      { day: "2026-05-13", status: "pending", hackatimeSeconds: 0, journalSeconds: 600 },
      { day: "2026-05-23", status: "pending", hackatimeSeconds: 0, journalSeconds: 7200 },
      { day: "2026-05-24", status: "active", hackatimeSeconds: 0, journalSeconds: 7200 },
    ];
    expect(pendingDaysToRequalify(rows, TH)).toEqual(["2026-05-12", "2026-05-23"]);
  });

  test("threshold defaults to one hour when omitted", () => {
    expect(
      pendingDaysToRequalify([
        { day: "d", status: "pending", hackatimeSeconds: 3600, journalSeconds: 0 },
      ]),
    ).toEqual(["d"]);
  });
});

describe("projectDayCountsForStreak", () => {
  test("a day with qualifying hours always counts", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: true,
        userStreakStatus: "active",
        autoUseStreakFreezes: true,
        projectHasEarlierWork: true,
      }),
    ).toBe(true);
  });

  test("hours qualify even with no earlier work (start of a run)", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: true,
        userStreakStatus: "active",
        autoUseStreakFreezes: false,
        projectHasEarlierWork: false,
      }),
    ).toBe(true);
  });

  test("a frozen day counts for an auto-freeze project with a running streak", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: false,
        userStreakStatus: "frozen",
        autoUseStreakFreezes: true,
        projectHasEarlierWork: true,
      }),
    ).toBe(true);
  });

  test("a frozen day does NOT count when the project opted out of auto-freeze", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: false,
        userStreakStatus: "frozen",
        autoUseStreakFreezes: false,
        projectHasEarlierWork: true,
      }),
    ).toBe(false);
  });

  test("a frozen day does NOT seed a plant for a project with no earlier work", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: false,
        userStreakStatus: "frozen",
        autoUseStreakFreezes: true,
        projectHasEarlierWork: false,
      }),
    ).toBe(false);
  });

  test("review_protected days bridge but do not count toward the plant", () => {
    expect(
      projectDayCountsForStreak({
        hoursQualify: false,
        userStreakStatus: "review_protected",
        autoUseStreakFreezes: true,
        projectHasEarlierWork: true,
      }),
    ).toBe(false);
  });

  test("pending / missed / undefined sub-hour days never count", () => {
    for (const status of ["pending", "missed", undefined, null] as const) {
      expect(
        projectDayCountsForStreak({
          hoursQualify: false,
          userStreakStatus: status,
          autoUseStreakFreezes: true,
          projectHasEarlierWork: true,
        }),
      ).toBe(false);
    }
  });
});

describe("effectiveHackatimeNamesByProject", () => {
  const proj = (
    id: number,
    names: string[],
    createdAt: string,
    deletedAt: string | null = null,
  ) => ({
    id,
    hackatime_projects: names,
    created_at: new Date(createdAt),
    deleted_at: deletedAt ? new Date(deletedAt) : null,
  });

  test("earliest-created live project claims a shared name", () => {
    const map = effectiveHackatimeNamesByProject([
      proj(2, ["renderer"], "2026-07-26T17:17:00Z"),
      proj(1, ["renderer"], "2026-07-26T17:16:00Z"),
    ]);
    expect(map.get(1)).toEqual(["renderer"]);
    expect(map.get(2)).toEqual([]);
  });

  test("a soft-deleted project claims nothing, releasing the name to its live replacement", () => {
    const map = effectiveHackatimeNamesByProject([
      proj(15027, ["renderer"], "2026-07-26T17:16:52Z", "2026-07-26T17:23:09Z"),
      proj(15028, ["renderer"], "2026-07-26T17:17:48Z"),
    ]);
    expect(map.get(15027)).toEqual([]);
    expect(map.get(15028)).toEqual(["renderer"]);
  });

  test("within-array duplicates collapse to a single claim", () => {
    const map = effectiveHackatimeNamesByProject([
      proj(1, ["a", "a", "b"], "2026-01-01T00:00:00Z"),
    ]);
    expect(map.get(1)).toEqual(["a", "b"]);
  });
});
