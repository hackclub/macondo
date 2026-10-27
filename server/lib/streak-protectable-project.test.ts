import { describe, expect, test } from "bun:test";

import { hasProtectableProjectStreak } from "./streak-helpers";

describe("hasProtectableProjectStreak", () => {
  test("single opted-out project => false (the ticket case, no burn)", () => {
    // A burn would protect nothing because the project resets regardless.
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: false, project_streak_days: 1 },
      ]),
    ).toBe(false);
  });

  test("opted-in live project alongside an opted-out one => true (burn)", () => {
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: true, project_streak_days: 7 },
        { auto_use_streak_freezes: false, project_streak_days: 3 },
      ]),
    ).toBe(true);
  });

  test("opted-in but no live streak (0 days) => false", () => {
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: true, project_streak_days: 0 },
      ]),
    ).toBe(false);
  });

  test("every project opted out => false even with long streaks", () => {
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: false, project_streak_days: 30 },
        { auto_use_streak_freezes: false, project_streak_days: 12 },
      ]),
    ).toBe(false);
  });

  test("no projects => false", () => {
    expect(hasProtectableProjectStreak([])).toBe(false);
  });

  test("boundary: opted-in with exactly 1 streak day => true", () => {
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: true, project_streak_days: 1 },
      ]),
    ).toBe(true);
  });

  test("opted-in live project wins even when listed after opted-out ones", () => {
    expect(
      hasProtectableProjectStreak([
        { auto_use_streak_freezes: false, project_streak_days: 5 },
        { auto_use_streak_freezes: false, project_streak_days: 0 },
        { auto_use_streak_freezes: true, project_streak_days: 2 },
      ]),
    ).toBe(true);
  });

  // A project in review is already protected, so a freeze adds nothing for it.
  test("only opted-in live project is in review => false (no wasted burn)", () => {
    expect(
      hasProtectableProjectStreak(
        [{ id: 5029, auto_use_streak_freezes: true, project_streak_days: 15 }],
        new Set([5029]),
      ),
    ).toBe(false);
  });

  test("all opted-in live projects in review => false (Sabaridev/dhairya)", () => {
    expect(
      hasProtectableProjectStreak(
        [
          { id: 5434, auto_use_streak_freezes: true, project_streak_days: 3 },
          { id: 5673, auto_use_streak_freezes: true, project_streak_days: 10 },
          { id: 8841, auto_use_streak_freezes: false, project_streak_days: 0 },
        ],
        new Set([5434, 5673]),
      ),
    ).toBe(false);
  });

  test("an opted-in live project NOT in review => true (freeze still worth it)", () => {
    expect(
      hasProtectableProjectStreak(
        [
          { id: 1, auto_use_streak_freezes: true, project_streak_days: 8 }, // in review
          { id: 2, auto_use_streak_freezes: true, project_streak_days: 4 }, // workable
        ],
        new Set([1]),
      ),
    ).toBe(true);
  });

  test("omitting the review set preserves the original behavior", () => {
    expect(
      hasProtectableProjectStreak([
        { id: 1, auto_use_streak_freezes: true, project_streak_days: 3 },
      ]),
    ).toBe(true);
  });
});

describe("hasProtectableProjectStreak / deleted projects", () => {
  // Deletion clears neither streak column, so a deleted project kept burning freezes nightly.
  test("deleted opted-in project alone => false (no burn)", () => {
    expect(
      hasProtectableProjectStreak([
        {
          id: 15647,
          auto_use_streak_freezes: false,
          project_streak_days: 15,
        },
        {
          id: 15788,
          auto_use_streak_freezes: true,
          project_streak_days: 6,
          deleted_at: new Date("2026-08-14T02:05:25.838Z"),
        },
      ]),
    ).toBe(false);
  });

  test("a live opted-in project still burns alongside a deleted one", () => {
    expect(
      hasProtectableProjectStreak([
        { id: 1, auto_use_streak_freezes: true, project_streak_days: 4 },
        {
          id: 2,
          auto_use_streak_freezes: true,
          project_streak_days: 6,
          deleted_at: new Date("2026-08-14T02:05:25.838Z"),
        },
      ]),
    ).toBe(true);
  });
});
