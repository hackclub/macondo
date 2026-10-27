import { describe, expect, test } from "bun:test";

import {
  computeTeamRecompute,
  teamProjectStreakFromQualifyingDays,
} from "./streak-helpers";

const TODAY = "2026-06-02";

function days(...d: string[]): Set<string> {
  return new Set(d);
}

describe("teamProjectStreakFromQualifyingDays", () => {
  test("continuous run ending today counts every day", () => {
    const qualifying = days(
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: qualifying,
        floor: "2026-05-30",
        today: TODAY,
      }),
    ).toEqual({ streak: 4, lastWorked: "2026-06-02" });
  });

  test("today not yet worked but yesterday was => still live (grace)", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: days("2026-05-31", "2026-06-01"),
        floor: "2026-05-31",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-06-01" });
  });

  test("most recent work two days ago => lapsed, resets to 0", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: days("2026-05-29", "2026-05-30", "2026-05-31"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });

  test("gap before a live tail only counts the consecutive tail", () => {
    const qualifying = days(
      "2026-05-28",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: qualifying,
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 4, lastWorked: "2026-06-02" });
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
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: qualifying,
        floor: "2026-05-31",
        today: TODAY,
      }),
    ).toEqual({ streak: 3, lastWorked: "2026-06-02" });
  });

  test("no qualifying days => 0 / null", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: new Set<string>(),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });

  test("single qualifying day = today => streak 1", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: days("2026-06-02"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 1, lastWorked: "2026-06-02" });
  });

  test("days after today are ignored (clock skew safety)", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: days("2026-06-01", "2026-06-02", "2026-06-03"),
        floor: "2026-05-01",
        today: TODAY,
      }),
    ).toEqual({ streak: 2, lastWorked: "2026-06-02" });
  });

  test("floor after today => 0 (degenerate window)", () => {
    expect(
      teamProjectStreakFromQualifyingDays({
        qualifyingDays: days("2026-06-02"),
        floor: "2026-06-10",
        today: TODAY,
      }),
    ).toEqual({ streak: 0, lastWorked: null });
  });
});

describe("computeTeamRecompute (engine union model)", () => {
  const floor = "2026-05-25";

  test("continuous team work from a clean floor counts every qualifying day", () => {
    const q = days(
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 0,
      storedLastWorked: null,
    });
    expect(r.streak).toBe(9);
    expect(r.lastWorked).toBe("2026-06-02");
    expect(r.lastBreak).toBeNull();
    expect(r.walkFloor).toBe(floor);
  });

  test("a member idle while another covers does not break it (union)", () => {
    const q = days(
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
    );
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 0,
      storedLastWorked: null,
    });
    // unworked today (06-02) is in-flight grace, not a break
    expect(r.streak).toBe(8);
    expect(r.lastWorked).toBe("2026-06-01");
    expect(r.lastBreak).toBeNull();
  });

  test("a frozen/protected day bridges a sub-1h team day (no break)", () => {
    const q = days(
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      // 05-30 missing from qualifying (sub-1h)
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    const covered = new Set(q);
    covered.add("2026-05-30"); // bridged by a member freeze
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: covered,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 0,
      storedLastWorked: null,
    });
    expect(r.lastBreak).toBeNull();
    expect(r.walkFloor).toBe(floor);
    expect(r.streak).toBe(8); // 8 qualifying days (05-30 bridged, not counted)
    expect(r.lastWorked).toBe("2026-06-02");
  });

  test("an uncovered gap day breaks the streak and resets the walk floor", () => {
    const q = days(
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      // 05-28 break (not in qualifying, not in covered)
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 0,
      storedLastWorked: null,
    });
    expect(r.lastBreak).toBe("2026-05-28");
    expect(r.walkFloor).toBe("2026-05-29");
    expect(r.streak).toBe(5);
    expect(r.lastWorked).toBe("2026-06-02");
  });

  test("never strips a higher stored value on a lower recount", () => {
    // nothing qualifies after stored last_worked, so there is nothing to credit
    const q = days("2026-05-31", "2026-06-01", "2026-06-02");
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 21,
      storedLastWorked: "2026-06-02",
    });
    expect(r.recomputed).toBe(3);
    expect(r.streak).toBe(21); // held, not stripped to 3
  });

  test("worked a new day after stored last_worked => credits +1 (goes up)", () => {
    const q = days("2026-05-31", "2026-06-01", "2026-06-02");
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 21,
      storedLastWorked: "2026-06-01",
    });
    expect(r.streak).toBe(22);
    expect(r.lastWorked).toBe("2026-06-02");
  });

  test("credits qualifying days stranded after stored last_worked", () => {
    const q = days(
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    );
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: floor,
      today: TODAY,
      storedStreak: 5,
      storedLastWorked: "2026-05-29",
    });
    // recomputed 9 beats stored 5, so it heals to 9 directly
    expect(r.streak).toBe(9);
    expect(r.lastWorked).toBe("2026-06-02");
  });

  test("today being unqualified is not a break (in-flight grace)", () => {
    const q = days("2026-05-31", "2026-06-01");
    const r = computeTeamRecompute({
      qualifyingDays: q,
      coveredDays: q,
      projectFloor: "2026-05-31",
      today: TODAY,
      storedStreak: 0,
      storedLastWorked: null,
    });
    expect(r.lastBreak).toBeNull();
    expect(r.streak).toBe(2);
    expect(r.lastWorked).toBe("2026-06-01");
  });
});
