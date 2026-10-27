// Keys are read-only, and isApiKeyEligible is the only policy. getSession never reads the
// Authorization header, so cookie-only surfaces (the /api/internal gate) can't be opened by a key.
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import db from "../db";
import { apiKeyTable, users } from "../db/schema";
import { getActiveMacondoBan } from "./macondo-ban";

export const API_KEY_PREFIX = "macondo_pat_";

export const MAX_ACTIVE_API_KEYS = 5;

// API keys have 256 random bits, not human-chosen passwords. Fast hashing is
// intentional for indexed lookup; changing it would invalidate existing keys.
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The raw value is returned ONCE; only its hash persists. */
export function generateApiKey(): { raw: string; hash: string; last4: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString("base64url"); // 256 bits of entropy
  return { raw, hash: sha256(raw), last4: raw.slice(-4) };
}

export interface ApiKeyAuth {
  user: typeof users.$inferSelect;
  keyId: string;
  keyLabel: string;
}

// Ineligible requests 401 in the middleware so integrators learn the boundary.
const API_KEY_DENIED_PREFIXES = [
  // server/middleware/auth.ts must never see a key-authed principal.
  "/api/internal",
  // Has its own bearer auth (macondo_mcp_) and the OAuth connector machinery.
  "/api/mcp",
  "/api/oauth",
  // A key must never mint or destroy cookie sessions (/api/auth/me is the whoami exception).
  "/api/auth",
  // Key management is session-only.
  "/api/user/api-keys",
  // Dev/debug endpoints and inbound webhooks (which carry their own auth).
  "/api/dev",
  "/api/_dev",
  "/api/webhooks",
];

// me.get.ts strips PII locker addresses when key-authed.
const API_KEY_ALLOWED_EXCEPTIONS = new Set(["/api/auth/me"]);

export function isApiKeyEligible(path: string, method: string): boolean {
  // Ops kill switch: disable all key auth without a deploy.
  if (process.env.MACONDO_API_KEYS_DISABLED === "1") return false;
  // Read-only v1: a leaked key must not be able to buy, ship, or delete.
  if (method !== "GET" && method !== "HEAD") return false;
  if (!path.startsWith("/api/")) return false;
  if (API_KEY_ALLOWED_EXCEPTIONS.has(path)) return true;
  return !API_KEY_DENIED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}

// 10s TTL (vs sessions' 5s): key traffic is steady, and revocation still lands within 10s per replica.
const API_KEY_CACHE_TTL_MS = Number(process.env.API_KEY_CACHE_TTL_MS ?? 10_000);
const API_KEY_CACHE_MAX = Number(process.env.API_KEY_CACHE_MAX ?? 500);
type ApiKeyCacheEntry = { auth: ApiKeyAuth; cachedAt: number };
const apiKeyCache = new Map<string, ApiKeyCacheEntry>();

function readApiKeyCache(hash: string): ApiKeyAuth | null {
  const hit = apiKeyCache.get(hash);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > API_KEY_CACHE_TTL_MS) {
    apiKeyCache.delete(hash);
    return null;
  }
  // Re-set moves the entry to the back of Map insertion order (LRU touch).
  apiKeyCache.delete(hash);
  apiKeyCache.set(hash, hit);
  return hit.auth;
}

function writeApiKeyCache(hash: string, auth: ApiKeyAuth): void {
  if (apiKeyCache.size >= API_KEY_CACHE_MAX) {
    const first = apiKeyCache.keys().next().value;
    if (first !== undefined) apiKeyCache.delete(first);
  }
  apiKeyCache.set(hash, { auth, cachedAt: Date.now() });
}

// Revocation only knows the key id but the cache is keyed by hash, so clear everything.
export function invalidateApiKeyCache(): void {
  apiKeyCache.clear();
}

/** The ban check runs on cache miss only, so it costs one query per key per TTL, not per request. */
export async function validateApiKey(raw: string): Promise<ApiKeyAuth | null> {
  if (!raw.startsWith(API_KEY_PREFIX)) return null;

  const hash = sha256(raw);
  const cached = readApiKeyCache(hash);
  if (cached) return cached;

  const [row] = await db
    .select({
      id: apiKeyTable.id,
      label: apiKeyTable.label,
      revoked_at: apiKeyTable.revoked_at,
      expires_at: apiKeyTable.expires_at,
      last_used_at: apiKeyTable.last_used_at,
      user: users,
    })
    .from(apiKeyTable)
    .innerJoin(users, eq(users.id, apiKeyTable.user_id))
    .where(eq(apiKeyTable.token_hash, hash))
    .limit(1);

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;

  try {
    if (await getActiveMacondoBan(row.user.id)) return null;
  } catch (err) {
    // A failed ban lookup must never authorize a banned account.
    console.error("[api-keys] ban lookup failed", err);
    return null;
  }

  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) { // write last_used_at at most once a minute
    db.update(apiKeyTable)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeyTable.id, row.id))
      .catch(() => {});
  }

  const auth: ApiKeyAuth = {
    user: row.user,
    keyId: row.id,
    keyLabel: row.label,
  };
  writeApiKeyCache(hash, auth);
  return auth;
}
