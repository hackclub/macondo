// Senders are checked by reading their source
// because DB-mocking tests are brittle across a shared bun process.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MACONDO_END_MS,
  SHIP_EXTENSION_DEADLINE_MS,
  macondoHasEnded,
} from "./macondo-end";

const MINUTE = 60 * 1000;

describe("macondoHasEnded", () => {
  test("ends at 23:59 Eastern on 31 August 2026", () => {
    expect(new Date(MACONDO_END_MS).toISOString()).toBe(
      "2026-09-01T03:59:00.000Z",
    );
  });

  test("tracks the LAST ship window, not the base deadline", () => {
    // The extension cohort could still ship after the base deadline.
    expect(MACONDO_END_MS).toBe(SHIP_EXTENSION_DEADLINE_MS);
  });

  test("is false right up to the deadline and true after it", () => {
    expect(macondoHasEnded(MACONDO_END_MS - MINUTE)).toBe(false);
    expect(macondoHasEnded(MACONDO_END_MS)).toBe(false);
    expect(macondoHasEnded(MACONDO_END_MS + MINUTE)).toBe(true);
  });

  test("is true now (the event is in the past)", () => {
    expect(macondoHasEnded()).toBe(true);
  });
});

describe("streak DM senders are gated on the event being over", () => {
  for (const file of [
    "streak-reminders.ts",
    "zero-streak-reminders.ts",
    "hackatime-reconnect-nudge.ts",
  ]) {
    test(`${file} checks macondoHasEnded before sending`, () => {
      const src = readFileSync(join(import.meta.dir, file), "utf8");
      expect(src).toContain('from "./macondo-end"');
      expect(src).toMatch(/if \(macondoHasEnded\(\)/);
      // The DM itself must come after the gate, never before it.
      expect(src.indexOf("macondoHasEnded()")).toBeLessThan(
        src.indexOf("await dm("),
      );
    });
  }
});
