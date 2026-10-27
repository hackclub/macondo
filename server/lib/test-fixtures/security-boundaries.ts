import { afterAll, describe, expect, mock, test } from "bun:test";
import * as h3 from "h3";
import { PgDialect } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";

Object.assign(globalThis, h3, {
  useRuntimeConfig: () => ({ hackclubAuthClientSecret: "local-test-secret" }),
});
mock.module("../../db", () => ({ default: {} }));
mock.module("../macondo-ban", () => ({ getActiveMacondoBan: async () => null }));
mock.module("../referrals", () => ({ resolveReferralCode: async () => null }));

const { sessionTokenCondition } = await import("../session");
const { default: internalGate } = await import("../../middleware/auth");
const { default: requestSecurity } = await import("../../middleware/0.z-request-security");
const { default: surfaceGate } = await import("../../middleware/0.surface");
const { isDevDebugAvailable } = await import("../dev-debug-flags");
const { setInternalReauthCookie, verifyInternalReauthCookie } = await import("../internal-reauth");
const env = { ...process.env };
afterAll(() => { process.env = env; });

function appWith(handler: h3.EventHandler) {
  const app = h3.createApp();
  app.use(handler);
  app.use(h3.defineEventHandler(() => ({ ok: true })));
  return h3.toWebHandler(app);
}

describe("security boundaries", () => {
  test("session hashes cannot be replayed as cookie tokens", () => {
    const raw = "a-local-random-cookie-token";
    const stored = createHash("sha256").update(raw).digest("hex");
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(sessionTokenCondition(raw)).params).toEqual([stored]);
    expect(dialect.sqlToQuery(sessionTokenCondition(stored)).params).not.toContain(stored);
  });

  test("legacy plaintext session tokens are rejected", () => {
    const legacy = "legacy-plaintext-session-token";
    expect(new PgDialect().sqlToQuery(sessionTokenCondition(legacy)).params).not.toContain(legacy);
  });

  test("internal gates cover encoded and case-variant paths", async () => {
    const handle = appWith(internalGate);
    for (const path of ["/api/internal/users", "/api/interna%6C/users", "/API/INTERNAL/users"]) {
      expect((await handle(new Request(`http://localhost${path}`))).status).toBe(401);
    }
    expect((await handle(new Request("http://localhost/Internal/dashboard"))).status).toBe(302);
  });

  test("cookie mutations require a trusted browser origin", async () => {
    process.env.NODE_ENV = "production";
    const handle = appWith(requestSecurity);
    const send = (headers: Record<string, string>) => handle(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { cookie: "macondo_session=local-test-token", ...headers },
    }));
    expect((await send({ origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send({ origin: "null" })).status).toBe(403);
    expect((await send({})).status).toBe(403);
    expect((await send({ origin: "https://macondo.hackclub.com" })).status).toBe(200);
  });

  test("bearer-only OAuth and signed webhooks remain independent of cookies", async () => {
    const handle = appWith(requestSecurity);
    for (const path of ["/oauth/token", "/api/webhooks/ari", "/api/mcp"]) {
      expect((await handle(new Request(`http://localhost${path}`, {
        method: "POST", headers: { cookie: "macondo_session=irrelevant", origin: "https://connector.example" },
      }))).status).toBe(200);
    }
  });

  test("MCP is unavailable unless explicitly enabled", async () => {
    delete process.env.MACONDO_MCP_ENABLED;
    const handle = appWith(surfaceGate);
    for (const path of ["/api/mcp", "/api/oauth/authorize", "/oauth/register", "/oauth/token", "/.well-known/oauth-protected-resource", "/API/MCP", "/api/m%63p"]) {
      expect((await handle(new Request(`http://localhost${path}`))).status).toBe(404);
    }
    process.env.MACONDO_MCP_ENABLED = "1";
    expect((await handle(new Request("http://localhost/api/mcp"))).status).toBe(200);
  });

  test("developer policy bypasses need an explicit local opt-in", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MACONDO_DEV_TOOLS_ENABLED;
    expect(isDevDebugAvailable()).toBe(false);
    process.env.MACONDO_DEV_TOOLS_ENABLED = "1";
    expect(isDevDebugAvailable()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isDevDebugAvailable()).toBe(false);
  });

  test("step-up cookies reject wrong users, tampering and expiry", async () => {
    process.env.NODE_ENV = "production";
    const handle = appWith(h3.defineEventHandler((event) => {
      setInternalReauthCookie(event, "staff-test-user");
      return { ok: true };
    }));
    const response = await handle(new Request("http://localhost"));
    const cookie = decodeURIComponent(response.headers.get("set-cookie")!.split(";")[0]!.split("=").slice(1).join("="));
    expect(verifyInternalReauthCookie(cookie, "staff-test-user").verified).toBe(true);
    expect(verifyInternalReauthCookie(cookie, "another-user").verified).toBe(false);
    expect(verifyInternalReauthCookie(cookie + ".extra", "staff-test-user").verified).toBe(false);
    expect(verifyInternalReauthCookie(cookie.replace(/\.\d+\./, ".1."), "staff-test-user").verified).toBe(false);
    expect(verifyInternalReauthCookie(cookie.slice(0, -1) + "!", "staff-test-user").verified).toBe(false);
  });
});
