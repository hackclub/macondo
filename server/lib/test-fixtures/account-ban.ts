import { describe, expect, mock, test } from "bun:test";
import * as h3 from "h3";

let banned = true;
mock.module("../session", () => ({ getSession: async () => ({ id: "local-user" }) }));
mock.module("../macondo-ban", () => ({ getActiveMacondoBan: async () => banned ? { active: true } : null }));
const { default: banGate } = await import("../../middleware/2.account-ban");

describe("account ban enforcement", () => {
  test("a banned session cannot bypass the UI with direct API requests", async () => {
    const app = h3.createApp();
    app.use(banGate);
    app.use(h3.defineEventHandler(() => ({ ok: true })));
    const fetch = h3.toWebHandler(app);
    const request = (path: string) => new Request(`http://localhost${path}`, { headers: { cookie: "macondo_session=local-token" } });
    expect((await fetch(request("/api/shop/my-orders"))).status).toBe(403);
    expect((await fetch(request("/api/internal/users"))).status).toBe(403);
    expect((await fetch(request("/api/auth/me"))).status).toBe(200);
    expect((await fetch(request("/api/auth/logout"))).status).toBe(200);
    banned = false;
    expect((await fetch(request("/api/shop/my-orders"))).status).toBe(200);
  });
});
