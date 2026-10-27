import { describe, expect, test } from "bun:test";

import {
  MISSED_VERDICT_GRACE_HOURS,
  inPostMidnightGrace,
  localHourInTz,
} from "./streak-helpers";

describe("localHourInTz", () => {
  test("returns the hour in the requested IANA timezone", () => {
    const t = new Date("2026-07-15T17:05:13Z");
    expect(localHourInTz(t, "Asia/Bangkok")).toBe(0); // UTC+7 -> 00:05
    expect(localHourInTz(t, "America/New_York")).toBe(13);
  });

  test("falls back to UTC for missing or invalid timezones", () => {
    const t = new Date("2026-07-15T17:05:13Z");
    expect(localHourInTz(t, null)).toBe(17);
    expect(localHourInTz(t, "Not/A_Real_Tz")).toBe(17);
  });
});

describe("inPostMidnightGrace", () => {
  test("the NOT_A_ROBOT reset instant is inside the window", () => {
    expect(inPostMidnightGrace(new Date("2026-07-15T17:05:13Z"), "Asia/Bangkok")).toBe(true);
  });

  test("closes once the grace hours have passed", () => {
    // 20:00Z = 03:00 Bangkok, first hour outside the 3h window.
    expect(inPostMidnightGrace(new Date("2026-07-15T19:59:00Z"), "Asia/Bangkok")).toBe(true);
    expect(inPostMidnightGrace(new Date("2026-07-15T20:00:00Z"), "Asia/Bangkok")).toBe(false);
  });

  test("well clear of midnight is never in grace", () => {
    expect(inPostMidnightGrace(new Date("2026-07-15T05:00:00Z"), "Asia/Bangkok")).toBe(false);
  });

  test("grace hours knob is respected", () => {
    const t = new Date("2026-07-15T18:30:00Z");
    expect(inPostMidnightGrace(t, "Asia/Bangkok", 1)).toBe(false);
    expect(inPostMidnightGrace(t, "Asia/Bangkok", 2)).toBe(true);
  });

  test("window is a small fraction of the day", () => {
    expect(MISSED_VERDICT_GRACE_HOURS).toBeGreaterThan(0);
    expect(MISSED_VERDICT_GRACE_HOURS).toBeLessThanOrEqual(6);
  });
});
