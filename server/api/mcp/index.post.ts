// Not behind the session middleware; auth is a per-request Bearer token that must
// resolve to a still-current supaadmin.
import type { H3Event } from "h3";

import { validateMcpToken } from "../../lib/mcp/auth";
import { dispatch } from "../../lib/mcp/server";
import { baseUrl } from "../../lib/mcp/oauth";
import { mlog, tail4 } from "../../lib/mcp/log";

function bearer(event: H3Event): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((getHeader(event, "authorization") ?? "").trim());
  return m ? m[1]!.trim() : null;
}

// RFC 9728: point unauthenticated clients (claude.ai) at the protected-resource
// metadata so they can discover the OAuth authorization server.
function challenge(event: H3Event): void {
  setResponseHeader(
    event,
    "WWW-Authenticate",
    `Bearer resource_metadata="${baseUrl(getRequestURL(event).origin)}/.well-known/oauth-protected-resource"`,
  );
  setResponseStatus(event, 401);
}

export default defineEventHandler(async (event) => {
  const raw = bearer(event);
  mlog("api", "POST /api/mcp", { bearer: tail4(raw) });
  if (!raw) {
    challenge(event);
    return { error: "missing bearer token" };
  }

  const ctx = await validateMcpToken(raw);
  if (!ctx) {
    challenge(event);
    return { error: "invalid or non-supaadmin token" };
  }
  mlog("api", "authed", { user: ctx.user.email, canWrite: ctx.canWrite });

  let body: unknown;
  try {
    body = await readBody(event);
  } catch {
    return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
  }

  // JSON-RPC batches (pre-2025-06-18 clients): process each, drop notification
  // nulls. A wholly-notification batch -> 202 with no body.
  if (Array.isArray(body)) {
    mlog("api", `batch of ${body.length}`);
    const out = (await Promise.all(body.map((m) => dispatch(m, ctx)))).filter(Boolean);
    if (out.length) return out;
    setResponseStatus(event, 202);
    return null;
  }

  const res = await dispatch((body ?? {}) as Parameters<typeof dispatch>[0], ctx);
  if (res) return res;
  setResponseStatus(event, 202);
  return null;
});
