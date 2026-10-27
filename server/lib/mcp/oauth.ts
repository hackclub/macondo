// claude.ai connectors can't send a static bearer, so they need OAuth. auth codes are
// persisted (not in-memory) so the round-trip survives restarts and multiple instances.
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import db from "../../db";
import { mcpAuthCodeTable } from "../../db/schema";
import { mlog, tail4 } from "./log";

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");

// prefer the configured base URL: behind a TLS-terminating proxy the request origin is internal
export function baseUrl(fallbackOrigin: string): string {
  return (
    (process.env.NUXT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "")
      .trim()
      .replace(/\/+$/, "") || fallbackOrigin
  );
}

export interface AuthCodeData {
  userId: string;
  canWrite: boolean;
  codeChallenge: string;
  redirectUri: string;
}

// RFC 8252-style redirect_uri sanity. The authorize page navigates the
// submitter's browser to this URL with a fresh auth code attached, so it must
// be a real https destination (loopback http allowed for local clients), with
// no credentials or fragments. This is not an allowlist: any registered client
// domain is permitted, so the page itself must surface the destination and the
// token exchange mandates PKCE, which together defeat code interception.
export function validateMcpRedirectUri(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "redirect_uri is not a valid URL.";
  }

  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const isLoopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1";

  if (url.protocol === "https:") {
    // https destinations are fine anywhere.
  } else if (url.protocol === "http:" && isLoopback) {
    // RFC 8252 permits http only for loopback (local MCP clients).
  } else {
    return "redirect_uri must be an https URL (http is only allowed for localhost).";
  }

  if (url.username || url.password) {
    return "redirect_uri must not contain a username or password.";
  }
  if (url.hash) {
    return "redirect_uri must not contain a fragment.";
  }

  return null;
}

export async function issueAuthCode(data: AuthCodeData): Promise<string> {
  const code = b64url(randomBytes(32));
  await db.insert(mcpAuthCodeTable).values({
    code_hash: sha256hex(code),
    user_id: data.userId,
    can_write: data.canWrite,
    code_challenge: data.codeChallenge,
    redirect_uri: data.redirectUri,
    expires_at: new Date(Date.now() + 5 * 60_000), // auth codes expire after 5 minutes
  });
  mlog("oauth", "auth code issued", {
    code: tail4(code),
    userId: data.userId,
    canWrite: data.canWrite,
    redirectUri: data.redirectUri,
    hasChallenge: !!data.codeChallenge,
  });
  return code;
}

export async function consumeAuthCode(code: string): Promise<AuthCodeData | null> {
  // Atomic single-statement consume (DELETE ... RETURNING): a SELECT-then-DELETE
  // pair can double-spend one code under concurrent exchanges.
  const [row] = await db
    .delete(mcpAuthCodeTable)
    .where(eq(mcpAuthCodeTable.code_hash, sha256hex(code)))
    .returning();
  if (!row) {
    mlog("oauth", "consume: code not found", { code: tail4(code) });
    return null;
  }
  if (row.expires_at.getTime() < Date.now()) {
    mlog("oauth", "consume: code expired", { code: tail4(code) });
    return null;
  }
  mlog("oauth", "consume: ok", { code: tail4(code), userId: row.user_id });
  return {
    userId: row.user_id,
    canWrite: row.can_write,
    codeChallenge: row.code_challenge,
    redirectUri: row.redirect_uri,
  };
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) {
    mlog("oauth", "pkce: missing verifier or challenge", {
      hasVerifier: !!verifier,
      hasChallenge: !!challenge,
    });
    return false;
  }
  const ok = b64url(createHash("sha256").update(verifier).digest()) === challenge;
  mlog("oauth", `pkce: ${ok ? "match" : "MISMATCH"}`);
  return ok;
}

// RFC 9728
export function protectedResourceMetadata(origin: string) {
  mlog("oauth", "discovery: protected-resource", { origin });
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  };
}

// RFC 8414
export function authServerMetadata(origin: string) {
  mlog("oauth", "discovery: authorization-server", { origin });
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    // RFC 9207: strict clients abort the flow if `iss` is missing
    authorization_response_iss_parameter_supported: true,
  };
}
