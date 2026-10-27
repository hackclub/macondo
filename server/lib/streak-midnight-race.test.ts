import { describe, expect, test } from "bun:test";

import { dayInTz } from "./streak-helpers";

describe("dayInTz", () => {
  test("returns YYYY-MM-DD in the requested IANA timezone", () => {
    const t = new Date("2026-05-14T18:30:00Z");
    expect(dayInTz(t, "America/New_York")).toBe("2026-05-14");
    expect(dayInTz(t, "Asia/Tokyo")).toBe("2026-05-15");
  });

  test("falls back to UTC for invalid timezone strings", () => {
    expect(dayInTz(new Date("2026-05-14T23:30:00Z"), "Not/A_Real_Tz")).toBe("2026-05-14");
  });

  test("treats a missing timezone as UTC", () => {
    expect(dayInTz(new Date("2026-05-14T23:30:00Z"))).toBe("2026-05-14");
  });
});

describe("midnight-race fingerprint", () => {
  test("T_db just before midnight + T_node just after = different days (NY)", () => {
    const tz = "America/New_York";

    const dpaDay = dayInTz(new Date("2026-04-21T03:59:59.500Z"), tz);
    const streakDay = dayInTz(new Date("2026-04-21T04:00:00.500Z"), tz);

    expect(dpaDay).toBe("2026-04-20");
    expect(streakDay).toBe("2026-04-21");
    expect(dpaDay).not.toBe(streakDay);
  });

  test("same race in Asia/Tokyo (positive offset)", () => {
    // Tokyo is UTC+9. Local midnight = UTC 15:00 the previous day.
    const tz = "Asia/Tokyo";

    expect(dayInTz(new Date("2026-04-20T14:59:59.500Z"), tz)).toBe("2026-04-20");
    expect(dayInTz(new Date("2026-04-20T15:00:00.500Z"), tz)).toBe("2026-04-21");
  });
});

describe("fix invariant: one `now` -> one day-key", () => {
  // journals.post.ts now threads one `now` Date to every write site, so they all get the same day.
  test("a single Date produces the same day-key for every callsite (NY, just before midnight)", () => {
    const now = new Date("2026-04-21T03:59:59.500Z");
    const tz = "America/New_York";

    const activityDay = dayInTz(now, tz);
    const streakDay = dayInTz(now, tz);
    const lastActiveDay = dayInTz(now, tz);

    expect(activityDay).toBe("2026-04-20");
    expect(activityDay).toBe(streakDay);
    expect(activityDay).toBe(lastActiveDay);
  });

  test("a single Date produces the same day-key for every callsite (Tokyo, just after midnight)", () => {
    const now = new Date("2026-04-20T15:00:00.500Z");
    const tz = "Asia/Tokyo";

    const activityDay = dayInTz(now, tz);
    const streakDay = dayInTz(now, tz);
    const lastActiveDay = dayInTz(now, tz);

    expect(activityDay).toBe("2026-04-21");
    expect(activityDay).toBe(streakDay);
    expect(activityDay).toBe(lastActiveDay);
  });

  test("the activity-day-vs-streak-day mismatch cannot happen when the same Date threads through", () => {
    const submitNow = new Date("2026-04-21T03:59:59.500Z");
    const tz = "America/New_York";

    const dpaDayFromCaller = dayInTz(submitNow, tz);
    const streakDayInsideExtend = dayInTz(submitNow, tz);

    expect(dpaDayFromCaller).toBe(streakDayInsideExtend);
  });
});
