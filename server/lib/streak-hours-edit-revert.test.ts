import { describe, expect, test } from "bun:test";

import {
  HACKATIME_STREAK_DAY_SECONDS,
  dayQualifiesForProjectStreak,
  hoursToSeconds,
} from "./streak-helpers";

describe("hours-edit revert: post-edit qualification", () => {
  test("1h journal edited to 0h no longer qualifies the day", () => {
    // Returning false here means the patch handler's revert path must fire.
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(0),
      }),
    ).toBe(false);
  });

  test("5h journal edited to 2h still qualifies (no revert needed)", () => {
    // The revert helper still runs on hours-down, but is a no-op because the day still qualifies.
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(2),
      }),
    ).toBe(true);
  });

  test("1h journal edited to 0h, but hackatime covers the day (no revert)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: HACKATIME_STREAK_DAY_SECONDS,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(0),
      }),
    ).toBe(true);
  });

  test("1h journal edited to 0h, but another journal on the day covers it (no revert)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(1) + hoursToSeconds(0),
      }),
    ).toBe(true);
  });

  test("1h journal edited to 0h with only a 0.5h sibling journal (revert)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(0.5) + hoursToSeconds(0),
      }),
    ).toBe(false);
  });

  test("hours edited from 1h to 0.5h falls below the floor (revert)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(0.5),
      }),
    ).toBe(false);
  });

  test("hours edited from 2h to 1h exactly hits the floor (no revert)", () => {
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: hoursToSeconds(1),
      }),
    ).toBe(true);
  });
});

describe("hours-edit revert: gate invariants", () => {
  // Pins the dauDelta math behind the patch handler's hours-down gate (dauDelta < 0, not archived, same local day).

  test("1h journal edited to 0h produces dauDelta < 0 (gate fires)", () => {
    expect(hoursToSeconds(0) - hoursToSeconds(1)).toBeLessThan(0);
  });

  test("0h journal edited to 1h produces dauDelta > 0 (extension branch, not revert)", () => {
    expect(hoursToSeconds(1) - hoursToSeconds(0)).toBeGreaterThan(0);
  });

  test("1h journal with title-only edit produces dauDelta === 0 (neither branch)", () => {
    expect(hoursToSeconds(1) - hoursToSeconds(1)).toBe(0);
  });

  test("0.1h rounding does not produce false negatives on the down-edit gate", () => {
    // hoursToSeconds rounds: 1.1h -> 3960, 1.0h -> 3600, a -360 delta.
    const after = hoursToSeconds(1.0);
    expect(after - hoursToSeconds(1.1)).toBeLessThan(0);
    // Combined still meets the floor though, so revert is a no-op.
    expect(
      dayQualifiesForProjectStreak({
        liveSeconds: 0,
        storedSeconds: 0,
        journalSeconds: after,
      }),
    ).toBe(true);
  });
});
