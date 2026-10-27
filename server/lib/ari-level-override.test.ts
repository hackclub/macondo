import { describe, expect, test } from "bun:test";

import { parseAriLevelOverride } from "./ari-level-override";

describe("parseAriLevelOverride", () => {
  test("returns the new level on a real string change", () => {
    expect(parseAriLevelOverride("2", "1")).toEqual({ newLevel: "1" });
    expect(parseAriLevelOverride("1", "4")).toEqual({ newLevel: "4" });
  });

  test("accepts a numeric field value", () => {
    expect(parseAriLevelOverride("2", 1)).toEqual({ newLevel: "1" });
    expect(parseAriLevelOverride("3", 2)).toEqual({ newLevel: "2" });
  });

  test("canonicalizes sloppy-but-valid values before comparing", () => {
    // "01" and "1.0" both mean level 1; never store them verbatim.
    expect(parseAriLevelOverride("2", "01")).toEqual({ newLevel: "1" });
    expect(parseAriLevelOverride("2", " 1 ")).toEqual({ newLevel: "1" });
    expect(parseAriLevelOverride("2", "1.0")).toEqual({ newLevel: "1" });
    // Canonical form equals current level -> no-op.
    expect(parseAriLevelOverride("1", "01")).toBeNull();
  });

  test("returns null when the level is unchanged", () => {
    expect(parseAriLevelOverride("2", "2")).toBeNull();
    expect(parseAriLevelOverride("3", 3)).toBeNull();
  });

  test("returns null for absent or empty field values", () => {
    expect(parseAriLevelOverride("2", null)).toBeNull();
    expect(parseAriLevelOverride("2", undefined)).toBeNull();
    expect(parseAriLevelOverride("2", "")).toBeNull();
    expect(parseAriLevelOverride("2", "   ")).toBeNull();
  });

  test("returns null for out-of-range or non-integer levels", () => {
    expect(parseAriLevelOverride("2", "0")).toBeNull();
    expect(parseAriLevelOverride("2", "5")).toBeNull();
    expect(parseAriLevelOverride("2", "2.5")).toBeNull();
    expect(parseAriLevelOverride("2", -1)).toBeNull();
  });

  test("returns null for non-numeric junk", () => {
    expect(parseAriLevelOverride("2", "abc")).toBeNull();
    expect(parseAriLevelOverride("2", "level 1")).toBeNull();
    expect(parseAriLevelOverride("2", true)).toBeNull();
    expect(parseAriLevelOverride("2", {})).toBeNull();
  });

  test("handles a null current level (first classification)", () => {
    expect(parseAriLevelOverride(null, "3")).toEqual({ newLevel: "3" });
    expect(parseAriLevelOverride(null, null)).toBeNull();
  });
});
