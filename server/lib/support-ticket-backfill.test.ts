import { describe, expect, test } from "bun:test";

import {
  recallBackfillSkip,
  rememberBackfillSkip,
} from "./support-backfill-negative-cache";
import {
  CAPYBARA_MAX_THREAD_AGE_MS,
  isFreshSlackTs,
} from "./support-backfill-freshness";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("backfill negative cache", () => {
  test("unremembered message is a miss", () => {
    expect(recallBackfillSkip("C0MISS", "1700.0001")).toBeNull();
  });

  test("remembered classification is returned", () => {
    rememberBackfillSkip("C0HIT", "1700.0002", "unknown_user");
    rememberBackfillSkip("C0HIT", "1700.0003", "bot_already_replied");
    expect(recallBackfillSkip("C0HIT", "1700.0002")).toBe("unknown_user");
    expect(recallBackfillSkip("C0HIT", "1700.0003")).toBe(
      "bot_already_replied",
    );
  });

  test("keys are channel-scoped, same ts in another channel misses", () => {
    rememberBackfillSkip("C0AAA", "1700.0004", "unknown_user");
    expect(recallBackfillSkip("C0BBB", "1700.0004")).toBeNull();
  });

  test("entries expire after the TTL so classifications can self-heal", () => {
    const t0 = 1_000_000;
    rememberBackfillSkip("C0TTL", "1700.0005", "unknown_user", t0);
    expect(recallBackfillSkip("C0TTL", "1700.0005", t0 + DAY_MS)).toBe(
      "unknown_user",
    );
    expect(
      recallBackfillSkip("C0TTL", "1700.0005", t0 + DAY_MS + 1),
    ).toBeNull();
  });

  test("cap evicts the oldest entry instead of growing unbounded", () => {
    rememberBackfillSkip("C0CAP", "oldest", "unknown_user");
    for (let i = 0; i < 5000; i++) {
      rememberBackfillSkip("C0CAP", `filler.${i}`, "bot_already_replied");
    }
    expect(recallBackfillSkip("C0CAP", "oldest")).toBeNull();
    expect(recallBackfillSkip("C0CAP", "filler.4999")).toBe(
      "bot_already_replied",
    );
  });
});

describe("capybara thread-freshness gate", () => {
  // 2026-07-27T12:00:00Z as epoch seconds, the shape Slack actually sends.
  const nowSeconds = 1785283200;
  const now = nowSeconds * 1000;
  const tsAt = (secondsAgo: number) => `${nowSeconds - secondsAgo}.001900`;

  test("a live webhook event is fresh", () => {
    expect(isFreshSlackTs(tsAt(2), now)).toBe(true);
  });

  test("a thread just inside the window is fresh", () => {
    expect(isFreshSlackTs(tsAt(59 * 60), now)).toBe(true);
  });

  test("a thread past the window is not, so a backfill stays quiet", () => {
    expect(isFreshSlackTs(tsAt(61 * 60), now)).toBe(false);
    // a deploy rescanning days-old messages must not post Capybara into them
    expect(isFreshSlackTs(tsAt(3 * 24 * 60 * 60), now)).toBe(false);
  });

  test("the boundary is exclusive", () => {
    expect(isFreshSlackTs(`${nowSeconds - CAPYBARA_MAX_THREAD_AGE_MS / 1000}.0`, now)).toBe(false);
  });

  test("unparseable or nonsense ts fails closed rather than throwing", () => {
    for (const bad of ["", "not-a-ts", "NaN", "-1", "0", "Infinity"]) {
      expect(isFreshSlackTs(bad, now)).toBe(false);
    }
  });

  test("a future ts (clock skew) is still treated as fresh, not rejected", () => {
    expect(isFreshSlackTs(`${nowSeconds + 30}.0`, now)).toBe(true);
  });
});
