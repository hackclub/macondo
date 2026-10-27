import { describe, expect, test } from "bun:test";

import {
  mintObfSecret,
  mintPathToken,
  mintUiToken,
  resolvePathTokenBucket,
  secretMatches,
  UI_TOKEN_TTL_MS,
  verifyUiToken,
} from "./ui-token";

const SECRET = "test-secret";

describe("mintUiToken / verifyUiToken", () => {
  test("round-trips within the TTL", () => {
    expect(verifyUiToken(SECRET, mintUiToken(SECRET))).toBe(true);
  });

  test("expires after the TTL", () => {
    const mintedAt = 1_700_000_000_000;
    const token = mintUiToken(SECRET, mintedAt);
    expect(verifyUiToken(SECRET, token, mintedAt + UI_TOKEN_TTL_MS - 1)).toBe(true);
    expect(verifyUiToken(SECRET, token, mintedAt + UI_TOKEN_TTL_MS + 1)).toBe(false);
  });

  test("rejects tampered expiry, tampered signature, and wrong secret", () => {
    const token = mintUiToken(SECRET);
    const [exp, sig] = token.split(".") as [string, string];
    expect(verifyUiToken(SECRET, `${Number(exp) + 60_000}.${sig}`)).toBe(false);
    expect(verifyUiToken(SECRET, `${exp}.${"0".repeat(sig.length)}`)).toBe(false);
    expect(verifyUiToken("other-secret", token)).toBe(false);
  });

  test("rejects garbage and empty inputs", () => {
    expect(verifyUiToken(SECRET, null)).toBe(false);
    expect(verifyUiToken(SECRET, "")).toBe(false);
    expect(verifyUiToken(SECRET, "not-a-token")).toBe(false);
    expect(verifyUiToken(SECRET, ".abc")).toBe(false);
    expect(verifyUiToken("", mintUiToken(SECRET))).toBe(false);
  });
});

describe("secretMatches", () => {
  test("exact match only", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET, `${SECRET} `)).toBe(false);
    expect(secretMatches(SECRET, "wrong")).toBe(false);
    expect(secretMatches(SECRET, null)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("rotating path token", () => {
  test("a bucket's token resolves back to that bucket", () => {
    expect(
      resolvePathTokenBucket(SECRET, mintPathToken(SECRET, 12_345), 12_345, 3),
    ).toBe(12_345);
  });

  test("accepts tokens inside the grace window and rejects older ones", () => {
    const current = 12_345;
    for (let back = 0; back <= 3; back++) {
      expect(
        resolvePathTokenBucket(
          SECRET,
          mintPathToken(SECRET, current - back),
          current,
          3,
        ),
      ).toBe(current - back);
    }
    expect(
      resolvePathTokenBucket(SECRET, mintPathToken(SECRET, current - 4), current, 3),
    ).toBeNull();
  });

  test("a future bucket is not accepted", () => {
    expect(
      resolvePathTokenBucket(SECRET, mintPathToken(SECRET, 12_346), 12_345, 3),
    ).toBeNull();
  });

  test("rejects a wrong secret and malformed input", () => {
    const token = mintPathToken(SECRET, 12_345);
    expect(resolvePathTokenBucket("other-secret", token, 12_345, 3)).toBeNull();
    for (const bad of ["", null, undefined, "z", `${token}x`]) {
      expect(resolvePathTokenBucket(SECRET, bad, 12_345, 3)).toBeNull();
    }
  });

  test("tokens are short, hex and bucket-specific", () => {
    expect(mintPathToken(SECRET, 1)).not.toBe(mintPathToken(SECRET, 2));
    expect(mintPathToken(SECRET, 1)).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe("payload key", () => {
  test("rotates per bucket, stable within one", () => {
    expect(mintObfSecret(SECRET, 7)).toBe(mintObfSecret(SECRET, 7));
    expect(mintObfSecret(SECRET, 7)).not.toBe(mintObfSecret(SECRET, 8));
    expect(mintObfSecret("other-secret", 7)).not.toBe(mintObfSecret(SECRET, 7));
  });

  test("does not expose the gate secret", () => {
    // handed to the browser, so it must not leak uiGateSecret
    const derived = mintObfSecret(SECRET, 7);
    expect(derived).not.toContain(SECRET);
    expect(secretMatches(SECRET, derived)).toBe(false);
    expect(derived).not.toBe(mintPathToken(SECRET, 7));
  });
});
