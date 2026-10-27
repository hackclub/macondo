// first-party.ts uses Nitro's auto-imported h3 helpers, so shim them on globalThis before importing it.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

type H3LikeError = Error & { statusCode?: number; statusMessage?: string };

let headers: Record<string, string> = {};

(globalThis as Record<string, unknown>).getHeader = (
  _event: unknown,
  name: string,
) => headers[name.toLowerCase()];

(globalThis as Record<string, unknown>).createError = (input: {
  statusCode?: number;
  statusMessage?: string;
}) => {
  const err = new Error(input.statusMessage ?? "error") as H3LikeError;
  err.statusCode = input.statusCode;
  err.statusMessage = input.statusMessage;
  return err;
};

let isFirstPartyRequest: typeof import("./first-party").isFirstPartyRequest;
let assertFirstPartyRequest: typeof import("./first-party").assertFirstPartyRequest;
beforeAll(async () => {
  ({ isFirstPartyRequest, assertFirstPartyRequest } = await import("./first-party"));
});

// The module reads process.env per call, so each test can set its own.
const savedEnv = { ...process.env };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const event = {} as any;

beforeEach(() => {
  headers = {};
  process.env.NODE_ENV = "production";
  delete process.env.MACONDO_FIRST_PARTY_CHECK_DISABLED;
  delete process.env.MACONDO_EXTRA_ALLOWED_ORIGINS;
  delete process.env.NUXT_PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("Fetch Metadata path", () => {
  test("accepts a same-origin browser fetch", () => {
    headers = {
      "sec-fetch-site": "same-origin",
      origin: "https://macondo.hackclub.com",
    };
    expect(isFirstPartyRequest(event)).toBe(true);
  });

  test("rejects cross-site, same-site and none", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      // A matching Origin must not rescue a bad Sec-Fetch-Site: the browser
      // writes that header and page JS cannot, so it wins.
      headers = { "sec-fetch-site": site, origin: "https://macondo.hackclub.com" };
      expect(isFirstPartyRequest(event)).toBe(false);
    }
  });

  test("is case- and whitespace-insensitive", () => {
    headers = { "sec-fetch-site": " Same-Origin " };
    expect(isFirstPartyRequest(event)).toBe(true);
  });
});

describe("Origin fallback (browsers without Fetch Metadata)", () => {
  test("accepts the canonical origin", () => {
    headers = { origin: "https://macondo.hackclub.com" };
    expect(isFirstPartyRequest(event)).toBe(true);
  });

  test("ignores path and case when comparing", () => {
    headers = { origin: "HTTPS://Macondo.Hackclub.com" };
    expect(isFirstPartyRequest(event)).toBe(true);
  });

  test("rejects another origin, a missing one, and an opaque one", () => {
    for (const origin of [
      "https://evil.example",
      // Lookalike hosts must not pass on a prefix/suffix match.
      "https://macondo.hackclub.com.evil.example",
      "https://notmacondo.hackclub.com",
      "null",
      "",
      "not a url",
    ]) {
      headers = origin ? { origin } : {};
      expect(isFirstPartyRequest(event)).toBe(false);
    }
  });

  test("a forged Host header cannot widen the allowlist", () => {
    // The allowlist is built from config only, never from the request, so
    // Host/X-Forwarded-Host are irrelevant no matter what they claim.
    headers = {
      origin: "https://evil.example",
      host: "evil.example",
      "x-forwarded-host": "evil.example",
    };
    expect(isFirstPartyRequest(event)).toBe(false);
  });

  test("honors configured and extra origins", () => {
    process.env.NUXT_PUBLIC_BASE_URL = "https://staging.macondo.hackclub.com";
    process.env.MACONDO_EXTRA_ALLOWED_ORIGINS =
      "https://preview-1.example, https://preview-2.example";
    for (const origin of [
      "https://staging.macondo.hackclub.com",
      "https://preview-1.example",
      "https://preview-2.example",
      // The canonical origin stays allowed alongside them.
      "https://macondo.hackclub.com",
    ]) {
      headers = { origin };
      expect(isFirstPartyRequest(event)).toBe(true);
    }
  });

  test("localhost is allowed outside production only", () => {
    headers = { origin: "http://localhost:3000" };
    expect(isFirstPartyRequest(event)).toBe(false);
    process.env.NODE_ENV = "development";
    expect(isFirstPartyRequest(event)).toBe(true);
  });
});

describe("kill switch and assert", () => {
  test("the kill switch lets everything through", () => {
    headers = { "sec-fetch-site": "cross-site" };
    expect(isFirstPartyRequest(event)).toBe(false);
    process.env.MACONDO_FIRST_PARTY_CHECK_DISABLED = "1";
    expect(isFirstPartyRequest(event)).toBe(true);
  });

  test("assert throws 403 on a rejected request and is silent otherwise", () => {
    headers = {};
    let thrown: H3LikeError | null = null;
    try {
      assertFirstPartyRequest(event);
    } catch (err) {
      thrown = err as H3LikeError;
    }
    expect(thrown?.statusCode).toBe(403);

    headers = { "sec-fetch-site": "same-origin" };
    expect(() => assertFirstPartyRequest(event)).not.toThrow();
  });
});
