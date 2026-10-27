import { describe, expect, mock, test } from "bun:test";
import * as h3 from "h3";

Object.assign(globalThis, h3, {
  useRuntimeConfig: () => ({ hackclubAuthClientSecret: "local-test-secret" }),
  defineWebSocketHandler: (hooks: unknown) => hooks,
});
mock.module("../../db", () => ({ default: {} }));
mock.module("../macondo-ban", () => ({ getActiveMacondoBan: async () => null }));
mock.module("../session", () => ({ getSessionByToken: async (token: string) => token === "valid-local-token" ? { id: "staff-user", roles: ["supaadmin"] } : null }));
mock.module("../realtime-presence", () => ({ heartbeatViewer() {}, joinViewer() {}, leaveViewer() {}, publishTyping() {} }));
mock.module("../realtime", () => ({ subscribePeer() {}, unsubscribePeer() {}, unsubscribePeerAll() {} }));
const { setInternalReauthCookie } = await import("../internal-reauth");

type Peer = {
  id: string;
  context: { authPromise?: Promise<void> };
  request: { headers: Headers };
  send(data: string): void;
  close(code: number, reason: string): void;
};
const hooks = (await import("../../api/_ws")).default as unknown as {
  upgrade(request: { headers: Headers }): Response | undefined;
  open(peer: Peer): void;
  message(peer: Peer, message: { text(): string; uint8Array(): Uint8Array }): Promise<void>;
  close(peer: Peer): Promise<void>;
};

function peer(cookie: string) {
  const sent: Array<Record<string, unknown>> = [];
  const closed: number[] = [];
  const p: Peer = { id: "local-peer", context: {}, request: { headers: new Headers({ cookie }) },
    send(data) { sent.push(JSON.parse(data)); }, close(code) { closed.push(code); } };
  return { p, sent, closed };
}
function message(value: unknown) {
  const text = JSON.stringify(value);
  return { text: () => text, uint8Array: () => new TextEncoder().encode(text) };
}

describe("WebSocket security", () => {
  test("upgrade rejects foreign and missing origins", () => {
    expect(hooks.upgrade({ headers: new Headers() })?.status).toBe(403);
    expect(hooks.upgrade({ headers: new Headers({ origin: "https://evil.example" }) })?.status).toBe(403);
    expect(hooks.upgrade({ headers: new Headers({ origin: "https://macondo.hackclub.com" }) })).toBeUndefined();
  });

  test("staff sessions need step-up to subscribe to the internal queue", async () => {
    const unauthenticated = peer("macondo_session=valid-local-token");
    hooks.open(unauthenticated.p);
    await unauthenticated.p.context.authPromise;
    await hooks.message(unauthenticated.p, message({ type: "subscribe", topic: "tickets:queue:internal" }));
    expect(unauthenticated.sent[0]?.isAdmin).toBe(false);
    expect(unauthenticated.sent.at(-1)?.code).toBe(403);
    await hooks.close(unauthenticated.p);

    const app = h3.createApp();
    app.use(h3.defineEventHandler((event) => { setInternalReauthCookie(event, "staff-user"); return "ok"; }));
    const response = await h3.toWebHandler(app)(new Request("http://localhost"));
    const stepUp = response.headers.get("set-cookie")!.split(";")[0];
    const verified = peer(`macondo_session=valid-local-token; ${stepUp}`);
    hooks.open(verified.p);
    await verified.p.context.authPromise;
    await hooks.message(verified.p, message({ type: "subscribe", topic: "tickets:queue:internal" }));
    expect(verified.sent[0]?.isAdmin).toBe(true);
    expect(verified.sent.at(-1)?.type).toBe("subscribed");
    await hooks.close(verified.p);
  });

  test("malformed cookies and oversized messages fail safely", async () => {
    const invalid = peer("macondo_session=%invalid");
    hooks.open(invalid.p);
    await invalid.p.context.authPromise;
    expect(invalid.closed).toContain(4001);
    const valid = peer("macondo_session=valid-local-token");
    hooks.open(valid.p);
    await valid.p.context.authPromise;
    await hooks.message(valid.p, message({ type: "ping", excess: "a".repeat(17 * 1024) }));
    expect(valid.closed).toContain(1009);
    await hooks.close(valid.p);
  });
});
