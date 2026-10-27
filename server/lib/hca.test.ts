import { describe, expect, test } from "bun:test";

import { shouldSkipForCooldown } from "./hca-cooldown";
import { isDeadRefreshToken, isHcaRateLimited } from "./hca-errors";

const NOW = new Date("2026-05-15T12:00:00Z");

describe("shouldSkipForCooldown", () => {
  test("force=true bypasses the cooldown unconditionally", () => {
    expect(
      shouldSkipForCooldown({ force: true, cooldownMs: 5 * 60_000 }, new Date(NOW.getTime() - 1_000), NOW),
    ).toBe(false);
  });

  test("null lastSyncAt never skips (first sync)", () => {
    expect(shouldSkipForCooldown({ cooldownMs: 5 * 60_000 }, null, NOW)).toBe(false);
  });

  test("inside the cooldown window skips", () => {
    expect(shouldSkipForCooldown({ cooldownMs: 5 * 60_000 }, new Date(NOW.getTime() - 60_000), NOW)).toBe(true);
  });

  test("exactly at the cooldown boundary does NOT skip", () => {
    // Strict less-than: equal is outside the window, so a <= flip is caught.
    expect(shouldSkipForCooldown({ cooldownMs: 5 * 60_000 }, new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(false);
  });

  test("beyond the cooldown window does not skip", () => {
    expect(shouldSkipForCooldown({ cooldownMs: 5 * 60_000 }, new Date(NOW.getTime() - 10 * 60_000), NOW)).toBe(false);
  });

  test("defaults to 5 minutes when cooldownMs is omitted", () => {
    expect(shouldSkipForCooldown({}, new Date(NOW.getTime() - 4 * 60_000), NOW)).toBe(true);
    expect(shouldSkipForCooldown({}, new Date(NOW.getTime() - 6 * 60_000), NOW)).toBe(false);
  });
});

describe("isDeadRefreshToken", () => {
  test("400 invalid_grant is dead", () => {
    expect(isDeadRefreshToken({ status: 400, data: { error: "invalid_grant" } })).toBe(true);
    expect(isDeadRefreshToken({ statusCode: 400, data: { error: "invalid_grant" } })).toBe(true);
  });

  test("other 400s are not, so a misconfigured client never wipes every token", () => {
    expect(isDeadRefreshToken({ status: 400, data: { error: "invalid_request" } })).toBe(false);
    expect(isDeadRefreshToken({ status: 400, data: "slow your roll!" })).toBe(false);
    expect(isDeadRefreshToken({ status: 401, data: { error: "invalid_client" } })).toBe(false);
  });

  test("outages and non-HTTP errors are not", () => {
    expect(isDeadRefreshToken({ status: 503, data: { error: "invalid_grant" } })).toBe(false);
    expect(isDeadRefreshToken(new Error("ECONNRESET"))).toBe(false);
    expect(isDeadRefreshToken(null)).toBe(false);
  });
});

describe("isHcaRateLimited", () => {
  test("only 429 counts", () => {
    expect(isHcaRateLimited({ status: 429, data: "slow your roll!" })).toBe(true);
    expect(isHcaRateLimited({ statusCode: 429 })).toBe(true);
    expect(isHcaRateLimited({ status: 400, data: { error: "invalid_grant" } })).toBe(false);
    expect(isHcaRateLimited(new Error("boom"))).toBe(false);
  });
});
