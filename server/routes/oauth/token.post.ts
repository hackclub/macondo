// Served at /oauth/token (not /api) to match the endpoint advertised in discovery.
import type { H3Event } from "h3";

import db from "../../db";
import { mcpTokenTable } from "../../db/schema";
import { generateMcpToken } from "../../lib/mcp/auth";
import { consumeAuthCode, verifyPkce } from "../../lib/mcp/oauth";
import { mlog, tail4 } from "../../lib/mcp/log";

const TOKEN_TTL_DAYS = 90;

function oauthError(
  event: H3Event,
  error: string,
  description: string,
  status = 400,
) {
  mlog("oauth", `token exchange FAILED: ${error}`, { description });
  setResponseStatus(event, status);
  setResponseHeader(event, "cache-control", "no-store");
  return { error, error_description: description };
}

export default defineEventHandler(async (event) => {
  // h3 parses both JSON and form-encoded bodies, so one read covers both.
  const parsed = (await readBody(event).catch(() => ({}))) as Record<string, unknown>;
  const get = (k: string) => String(parsed?.[k] ?? "");
  mlog("oauth", "token POST", {
    grant_type: get("grant_type"),
    code: tail4(get("code")),
    hasVerifier: !!get("code_verifier"),
  });

  if (get("grant_type") !== "authorization_code") {
    return oauthError(event, "unsupported_grant_type", "Only authorization_code is supported.");
  }

  const code = get("code");
  const data = code ? await consumeAuthCode(code) : null;
  if (!data) {
    return oauthError(event, "invalid_grant", "Authorization code is invalid or expired.");
  }

  // redirect_uri is required and must match exactly (RFC 6749 §4.1.3): a
  // code issued for one client's callback must never exchange for another.
  const ru = get("redirect_uri");
  if (!ru || ru !== data.redirectUri) {
    return oauthError(event, "invalid_grant", "redirect_uri is missing or does not match the authorization request.");
  }

  // PKCE is mandatory for this public-client flow (token_endpoint_auth_method:
  // none), so an intercepted authorization code alone can never be exchanged.
  if (!verifyPkce(get("code_verifier"), data.codeChallenge)) {
    return oauthError(event, "invalid_grant", "PKCE verification failed.");
  }

  const { raw, hash, last4 } = generateMcpToken();
  await db.insert(mcpTokenTable).values({
    token_hash: hash,
    user_id: data.userId,
    can_write: data.canWrite,
    label: "OAuth connection (claude.ai)",
    last4,
    expires_at: new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000), // ms per day
  });
  mlog("oauth", "token exchange OK — minted connection token", {
    token: tail4(raw),
    userId: data.userId,
    canWrite: data.canWrite,
  });

  setResponseHeader(event, "cache-control", "no-store");
  return {
    access_token: raw,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_DAYS * 86_400, // seconds per day
    scope: "mcp",
  };
});
