import { describe, expect, test } from "bun:test";

import {
  computeReviewProtectedDays,
  computeWorkAvailableReviewProtectedDays,
  planReviewProtectionBackfill,
} from "./streak-helpers";

describe("computeReviewProtectedDays", () => {
  test("ship still in review covers gap days up to endDay", () => {
    // 14:25 UTC is 22:25 Perth, so the ship was already queued for all of 05-18.
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-17T14:25:11.960Z"),
          created_at: new Date("2026-05-17T14:25:11.960Z"),
          reviewed_at: null,
        },
      ],
      "Australia/Perth",
      "2026-05-18",
      "2026-05-18",
    );
    expect([...got].sort()).toEqual(["2026-05-18"]);
  });

  test("multi-day in-queue ship covers every day in window", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-12T01:00:00Z"),
          created_at: new Date("2026-05-12T01:00:00Z"),
          reviewed_at: null,
        },
      ],
      "UTC",
      "2026-05-12",
      "2026-05-15",
    );
    expect([...got].sort()).toEqual([
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]);
  });

  test("reviewed mid-window only protects through reviewed_at day", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-12T01:00:00Z"),
          created_at: new Date("2026-05-12T01:00:00Z"),
          reviewed_at: new Date("2026-05-13T20:00:00Z"),
        },
      ],
      "UTC",
      "2026-05-12",
      "2026-05-15",
    );
    expect([...got].sort()).toEqual(["2026-05-12", "2026-05-13"]);
  });

  test("ship entered mid-window only protects from queue_entered_at forward", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-14T10:00:00Z"),
          created_at: new Date("2026-05-14T10:00:00Z"),
          reviewed_at: null,
        },
      ],
      "UTC",
      "2026-05-12",
      "2026-05-16",
    );
    expect([...got].sort()).toEqual([
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
    ]);
  });

  test("no ships => empty set", () => {
    expect(computeReviewProtectedDays([], "UTC", "2026-05-12", "2026-05-15").size).toBe(0);
  });

  test("queue_entered_at falls back to created_at when null", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: null,
          created_at: new Date("2026-05-13T05:00:00Z"),
          reviewed_at: null,
        },
      ],
      "UTC",
      "2026-05-13",
      "2026-05-13",
    );
    expect([...got]).toEqual(["2026-05-13"]);
  });

  test("ship with both timestamps null is skipped, not crash", () => {
    const got = computeReviewProtectedDays(
      [
        { queue_entered_at: null, created_at: null, reviewed_at: null },
      ],
      "UTC",
      "2026-05-12",
      "2026-05-15",
    );
    expect(got.size).toBe(0);
  });

  test("multiple ships union their protected windows", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-10T10:00:00Z"),
          created_at: new Date("2026-05-10T10:00:00Z"),
          reviewed_at: new Date("2026-05-11T20:00:00Z"),
        },
        {
          queue_entered_at: new Date("2026-05-14T10:00:00Z"),
          created_at: new Date("2026-05-14T10:00:00Z"),
          reviewed_at: null,
        },
      ],
      "UTC",
      "2026-05-09",
      "2026-05-15",
    );
    // no ship was in review on 05-12..05-13
    expect([...got].sort()).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-14",
      "2026-05-15",
    ]);
  });

  test("respects user timezone for day-key boundaries", () => {
    // 18:00 UTC is 05-17 14:00 in NYC but 05-18 03:00 in Tokyo.
    const submittedAt = new Date("2026-05-17T18:00:00Z");
    const ships = [
      {
        queue_entered_at: submittedAt,
        created_at: submittedAt,
        reviewed_at: null,
      },
    ];
    const gotNyc = computeReviewProtectedDays(
      ships,
      "America/New_York",
      "2026-05-17",
      "2026-05-18",
    );
    const gotTokyo = computeReviewProtectedDays(
      ships,
      "Asia/Tokyo",
      "2026-05-17",
      "2026-05-18",
    );
    expect([...gotNyc].sort()).toEqual(["2026-05-17", "2026-05-18"]);
    expect([...gotTokyo].sort()).toEqual(["2026-05-18"]);
  });

  test("startDay > endDay returns empty set", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: new Date("2026-05-12T01:00:00Z"),
          created_at: new Date("2026-05-12T01:00:00Z"),
          reviewed_at: null,
        },
      ],
      "UTC",
      "2026-05-15",
      "2026-05-12",
    );
    expect(got.size).toBe(0);
  });

  test("accepts ISO string timestamps as well as Date objects", () => {
    const got = computeReviewProtectedDays(
      [
        {
          queue_entered_at: "2026-05-17T14:25:11.960Z",
          created_at: "2026-05-17T14:25:11.960Z",
          reviewed_at: null,
        },
      ],
      "Australia/Perth",
      "2026-05-18",
      "2026-05-18",
    );
    expect([...got]).toEqual(["2026-05-18"]);
  });
});

describe("planReviewProtectionBackfill", () => {
  test("flips pending / missed / frozen days inside the protected set", () => {
    const plan = planReviewProtectionBackfill({
      protectedDays: ["2026-05-29", "2026-05-30", "2026-05-31"],
      statusByDay: new Map([
        ["2026-05-29", "pending"],
        ["2026-05-30", "missed"],
        ["2026-05-31", "frozen"],
      ]),
    });
    expect(plan).toEqual([
      { day: "2026-05-29", from: "pending", refundFreeze: false },
      { day: "2026-05-30", from: "missed", refundFreeze: false },
      { day: "2026-05-31", from: "frozen", refundFreeze: true },
    ]);
  });

  test("only frozen days earn a freeze refund", () => {
    const plan = planReviewProtectionBackfill({
      protectedDays: ["2026-05-31"],
      statusByDay: new Map([["2026-05-31", "frozen"]]),
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.refundFreeze).toBe(true);
  });

  test("leaves active and already-review_protected days untouched", () => {
    const plan = planReviewProtectionBackfill({
      protectedDays: ["2026-05-29", "2026-05-30"],
      statusByDay: new Map([
        ["2026-05-29", "active"],
        ["2026-05-30", "review_protected"],
      ]),
    });
    expect(plan).toEqual([]);
  });

  test("ignores protected days that have no streak_days row yet", () => {
    const plan = planReviewProtectionBackfill({
      protectedDays: ["2026-05-29", "2026-05-30"],
      statusByDay: new Map([["2026-05-29", "pending"]]),
    });
    // reconcile/recompute creates fresh rows; this helper only heals existing ones
    expect(plan).toEqual([
      { day: "2026-05-29", from: "pending", refundFreeze: false },
    ]);
  });

  test("returns days sorted ascending regardless of input order", () => {
    const plan = planReviewProtectionBackfill({
      protectedDays: ["2026-05-31", "2026-05-29", "2026-05-30"],
      statusByDay: new Map([
        ["2026-05-29", "pending"],
        ["2026-05-30", "pending"],
        ["2026-05-31", "pending"],
      ]),
    });
    expect(plan.map((p) => p.day)).toEqual([
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
    ]);
  });
});

describe("computeWorkAvailableReviewProtectedDays", () => {
  const openShip = (queueEntered: string) => ({
    queue_entered_at: new Date(queueEntered),
    created_at: new Date(queueEntered),
    reviewed_at: null,
  });

  test("single solo project in review protects every queue day (legit case preserved)", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: new Date("2026-05-01T12:00:00Z"),
          isTeam: false,
          projectStreakDays: 12,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-03",
    });
    expect([...got].sort()).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  test("a workable second project WITH a live streak denies all protection (the leak stays closed)", () => {
    // B was never queued and has a live streak, so it is a real workable alternative.
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 8,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          createdAt: "2026-05-02T12:00:00Z",
          isTeam: false,
          projectStreakDays: 3,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-03",
    });
    expect(got.size).toBe(0);
  });

  test("a 0-streak (abandoned) side project does NOT deny protection (Sabio 2026-06-16)", () => {
    // a 0-streak project has no plant to lose, so skipping it costs nothing
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 14,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          createdAt: "2026-04-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 0,
          ships: [],
        },
        {
          createdAt: "2026-04-15T12:00:00Z",
          isTeam: false,
          projectStreakDays: 0,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-03",
    });
    expect([...got].sort()).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  test("one live-streak side project among 0-streak ones still denies protection", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 14,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          createdAt: "2026-04-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 0,
          ships: [],
        },
        {
          createdAt: "2026-04-15T12:00:00Z",
          isTeam: false,
          projectStreakDays: 5,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-02",
    });
    expect(got.size).toBe(0);
  });

  test("a second project only denies protection from its creation day forward", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 9,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          createdAt: "2026-06-03T12:00:00Z",
          isTeam: false,
          projectStreakDays: 4,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-04",
    });
    expect([...got].sort()).toEqual(["2026-06-01", "2026-06-02"]);
  });

  test("only days where EVERY existing solo project is in the queue are protected", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 10,
          ships: [openShip("2026-06-01T12:00:00Z")], // in queue whole window
        },
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 6,
          ships: [
            {
              queue_entered_at: new Date("2026-06-01T12:00:00Z"),
              created_at: new Date("2026-06-01T12:00:00Z"),
              reviewed_at: new Date("2026-06-02T20:00:00Z"), // cleared after 06-02
            },
          ],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-03",
    });
    // on 06-03 the second project is workable again (live streak)
    expect([...got].sort()).toEqual(["2026-06-01", "2026-06-02"]);
  });

  test("team projects are excluded from the work-availability test", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 7,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          // team projects have their own engine and must not deny protection
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: true,
          projectStreakDays: 20,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-02",
    });
    expect([...got].sort()).toEqual(["2026-06-01", "2026-06-02"]);
  });

  test("a user with only team projects gets no protection from this path", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: true,
          projectStreakDays: 5,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-02",
    });
    expect(got.size).toBe(0);
  });

  test("startDay > endDay returns empty set", () => {
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 3,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-03",
      endDay: "2026-06-01",
    });
    expect(got.size).toBe(0);
  });

  test("a project with a missing/invalid creation instant is treated as always existing", () => {
    // a bad timestamp must never grant protection by looking like the project didn't exist yet
    const got = computeWorkAvailableReviewProtectedDays({
      projects: [
        {
          createdAt: "2026-05-01T12:00:00Z",
          isTeam: false,
          projectStreakDays: 11,
          ships: [openShip("2026-06-01T12:00:00Z")],
        },
        {
          createdAt: null,
          isTeam: false,
          projectStreakDays: 2,
          ships: [],
        },
      ],
      tz: "UTC",
      startDay: "2026-06-01",
      endDay: "2026-06-02",
    });
    expect(got.size).toBe(0);
  });
});
