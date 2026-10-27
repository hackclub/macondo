import { eq, inArray } from "drizzle-orm";
import db from "../db";
import { users } from "../db/schema";
import { writeAudit } from "./audit";
import {
  getFakeHackatimeHours,
  getFakeHackatimeMe,
  getFakeHackatimeProjects,
  getFakeLatestHeartbeat,
  isDevFakeHackatimeToken,
} from "./dev-fake-hackatime";
import { stripHackatimePlaceholderProjects } from "./hackatime-placeholder";
import { HACKATIME_URL } from "./api-urls";

const TRUST_CACHE_TTL_MS = Number(
  process.env.HACKATIME_TRUST_CACHE_TTL_MS ?? 3 * 60 * 60 * 1000,
);

interface TrustCacheEntry {
  trustLevel: string | null;
  expiresAt: number;
}

const trustCache = new Map<string, TrustCacheEntry>();

// Redis mirror shares trust levels across replicas; its TTL is a bit longer so the in-process cache stays authoritative.
const TRUST_REDIS_KEY_PREFIX = "hackatime:trust:";

async function readTrustCacheRedis(userId: string): Promise<TrustCacheEntry | null> {
  try {
    const { getRedis } = await import("./redis");
    const redis = await getRedis();
    if (!redis) return null;
    const raw = await redis.get(`${TRUST_REDIS_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as TrustCacheEntry;
  } catch {
    return null;
  }
}

async function writeTrustCacheRedis(userId: string, entry: TrustCacheEntry): Promise<void> {
  try {
    const { getRedis } = await import("./redis");
    const redis = await getRedis();
    if (!redis) return;
    await redis.set(
      `${TRUST_REDIS_KEY_PREFIX}${userId}`,
      JSON.stringify(entry),
      { EX: Math.ceil(TRUST_CACHE_TTL_MS / 1000) + 60 }, // a minute past the in-process ttl
    );
  } catch {
    // best-effort cache write
  }
}

function readTrustCache(userId: string): TrustCacheEntry | null {
  const hit = trustCache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    trustCache.delete(userId);
    return null;
  }
  return hit;
}

function writeTrustCache(userId: string, trustLevel: string | null) {
  // Read-path eviction only fires on a re-read, so past this size writes sweep expired entries.
  if (trustCache.size >= 2000) { // trust cache sweep threshold
    const now = Date.now();
    for (const [id, entry] of trustCache) {
      if (entry.expiresAt < now) trustCache.delete(id);
    }
  }
  const entry: TrustCacheEntry = {
    trustLevel,
    expiresAt: Date.now() + TRUST_CACHE_TTL_MS,
  };
  trustCache.set(userId, entry);
  void writeTrustCacheRedis(userId, entry);
}

export async function readTrustCacheShared(userId: string): Promise<TrustCacheEntry | null> {
  const local = readTrustCache(userId);
  if (local) return local;
  return readTrustCacheRedis(userId);
}

export interface HackatimeMeResponse {
  id: number;
  emails: string[];
  slack_id: string | null;
  github_username: string | null;
}

export interface HackatimeTrustFactor {
  trust_level: string;
  trust_value: number;
}

interface HackatimeAdminUserResponse {
  user?: {
    id: number;
    trust_level?: string | null;
    timezone?: string | null;
  };
}

interface HackatimeAdminUserByEmailResponse {
  user_id: number;
}

interface HackatimeAdminFuzzySearchResponse {
  users: Array<{
    id: number;
    email: string | null;
    username?: string | null;
  }>;
}

export interface HackatimeHoursResponse {
  start_date: string;
  end_date: string;
  total_seconds: number;
}

export interface HackatimeProject {
  name: string;
  total_seconds: number;
  most_recent_heartbeat: string;
  languages: string[];
  archived: boolean;
}

export interface HackatimeProjectsResponse {
  projects: HackatimeProject[];
}

export interface HackatimeLatestHeartbeatResponse {
  id: number;
  created_at: string;
  time: number;
  category: string;
  project: string;
  language: string;
  editor: string;
  operating_system: string;
  machine: string;
  entity: string;
}

export interface HackatimeTrustLookupInput {
  adminKey?: string | null;
  hackatimeId?: number | null;
  hackatimeOAuthToken?: string | null;
  email?: string | null;
  userId?: string | null;
}

const HACKATIME_OAUTH_MAX_RETRIES = 2;
const HACKATIME_OAUTH_BACKOFF_MS = 500;
// Without a per-attempt cap a hung upstream hangs the whole request until the gateway 502s.
const HACKATIME_OAUTH_TIMEOUT_MS = Number(
  process.env.HACKATIME_OAUTH_TIMEOUT_MS ?? 15000,
);
const hackatimeSleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

async function hackatimeOAuthRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T | null> {
  const url = `${HACKATIME_URL}${path}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(HACKATIME_OAUTH_TIMEOUT_MS),
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (res.ok) return (await res.json()) as T;

      // A 401/403 never recovers on retry (revoked token or restricted user); callers iterating
      // users should classifyHackatimeAuthFailure and persist hackatime_api_status.
      if ((res.status === 429 || res.status >= 500) && attempt < HACKATIME_OAUTH_MAX_RETRIES) { // rate limited or upstream error
        const retryAfter = Number(res.headers.get("retry-after"));
        await hackatimeSleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 5000) // honor retry-after, capped at 5s
            : HACKATIME_OAUTH_BACKOFF_MS * (attempt + 1),
        );
        continue;
      }

      console.error(
        `[hackatime] request failed (${path}): ${res.status} ${res.statusText}`,
      );
      return null;
    } catch (err) {
      // GETs are idempotent, so a bounded retry is safe.
      if (attempt < HACKATIME_OAUTH_MAX_RETRIES) {
        await hackatimeSleep(HACKATIME_OAUTH_BACKOFF_MS * (attempt + 1));
        continue;
      }
      console.error(`[hackatime] request error (${path}):`, err);
      return null;
    }
  }
}

// Without a timeout a stalled Hackatime holds the caller (and its socket) open indefinitely.
const HACKATIME_ADMIN_TIMEOUT_MS = Number(process.env.HACKATIME_ADMIN_TIMEOUT_MS ?? 5000);

async function hackatimeAdminRequest<T>(
  path: string,
  adminKey: string,
  init?: RequestInit,
  options?: { quietStatusCodes?: number[] },
): Promise<T | null> {
  try {
    const res = await fetch(`${HACKATIME_URL}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(HACKATIME_ADMIN_TIMEOUT_MS),
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${adminKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (!(options?.quietStatusCodes ?? []).includes(res.status)) {
        console.error(
          `[hackatime] admin request failed (${path}): ${res.status} ${res.statusText}`,
        );
      }
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    console.error(`[hackatime] admin request error (${path}):`, err);
    return null;
  }
}

export async function getAuthenticatedMe(
  accessToken: string,
): Promise<HackatimeMeResponse | null> {
  if (isDevFakeHackatimeToken(accessToken)) return getFakeHackatimeMe();

  return hackatimeOAuthRequest<HackatimeMeResponse>(
    "/api/v1/authenticated/me",
    accessToken,
  );
}

// "valid" only means the token is accepted: /me skips Hackatime's restricted-user filter.
// "unknown" is transient and must never trigger a reconnect nudge.
export async function checkHackatimeTokenStatus(
  accessToken: string,
): Promise<"valid" | "invalid" | "unknown"> {
  if (isDevFakeHackatimeToken(accessToken)) return "valid";
  try {
    const res = await fetch(`${HACKATIME_URL}/api/v1/authenticated/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (res.ok) return "valid";
    if (res.status === 401 || res.status === 403) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type HackatimeAuthFailure = "invalid_token" | "api_restricted" | "unknown";

// Restricted users (red trust / pending deletion) 401 everywhere except /me, which still serves trust_factor.
// Doorkeeper rejections carry a WWW-Authenticate invalid_token header; app-level 401s don't.
// Callers must not persist a status change on "unknown".
export async function classifyHackatimeAuthFailure(
  accessToken: string,
): Promise<HackatimeAuthFailure> {
  if (isDevFakeHackatimeToken(accessToken)) return "unknown";
  try {
    const res = await fetch(`${HACKATIME_URL}/api/v1/authenticated/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      const body = (await res.json()) as {
        trust_factor?: { trust_level?: string | null } | null;
      };
      if ((body?.trust_factor?.trust_level ?? "").trim().toLowerCase() === "red") return "api_restricted";
      return "unknown";
    }
    if (res.status === 401 || res.status === 403) {
      if ((res.headers.get("www-authenticate") ?? "").includes("invalid_token")) return "invalid_token";
      // App-level 401 on /me only comes from the pending-deletion filter.
      return "api_restricted";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function getAdminTrustFactorByUserId(
  adminKey: string,
  userId: number,
): Promise<HackatimeTrustFactor | null> {
  const trustLevel = (await hackatimeAdminRequest<HackatimeAdminUserResponse>(
    `/api/admin/v1/user/info?user_id=${encodeURIComponent(String(userId))}`,
    adminKey,
    undefined,
    { quietStatusCodes: [404] },
  ))?.user?.trust_level;
  return trustLevel
    ? {
        trust_level: trustLevel,
        trust_value: 0,
      }
    : null;
}

// Mirrors isValidIanaTimezone in server/api/auth/timezone.post.ts.
function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns null on missing / invalid tz so callers never overwrite a good local value.
export async function getHackatimeTimezoneByUserId(
  adminKey: string,
  hackatimeId: number,
): Promise<string | null> {
  const tz = (await hackatimeAdminRequest<HackatimeAdminUserResponse>(
    `/api/admin/v1/user/info?user_id=${encodeURIComponent(String(hackatimeId))}`,
    adminKey,
    undefined,
    { quietStatusCodes: [404] },
  ))?.user?.timezone?.trim();
  if (!tz || tz.length > 64 || !isValidIanaTimezone(tz)) return null; // reject implausibly long timezone names
  return tz;
}

// Writes users.timezone (read by the streak engine) too; without a Hackatime tz, browser sync owns it.
export async function syncHackatimeTimezone(params: {
  userId: string;
  hackatimeId: number | null;
  adminKey: string | null;
  currentTimezone: string | null;
  currentHackatimeTimezone: string | null;
}): Promise<string | null> {
  const {
    userId,
    hackatimeId,
    adminKey,
    currentTimezone,
    currentHackatimeTimezone,
  } = params;
  if (!hackatimeId || !adminKey) return null;

  let tz: string | null = null;
  try {
    tz = await getHackatimeTimezoneByUserId(adminKey, hackatimeId);
  } catch {
    console.error("[hackatime-tz] fetch failed");
    return null;
  }
  if (!tz) return null;

  // Hackatime's "UTC" means unset; writing it over a real zone forces streaks into UTC day buckets.
  const isUtcZone = (z: string | null | undefined): boolean =>
    z === "UTC" || z === "Etc/UTC";
  if (isUtcZone(tz)) {
    return currentTimezone && !isUtcZone(currentTimezone)
      ? currentTimezone
      : null;
  }

  if (tz === currentTimezone && tz === currentHackatimeTimezone) return tz;

  await db
    .update(users)
    .set({ hackatime_timezone: tz, timezone: tz })
    .where(eq(users.id, userId));

  try {
    await writeAudit({
      actor_id: userId,
      action: "user_timezone_hackatime_sync",
      entity_type: "user",
      entity_id: userId,
      old_value: {
        timezone: currentTimezone,
        hackatime_timezone: currentHackatimeTimezone,
      },
      new_value: { timezone: tz, hackatime_timezone: tz, source: "hackatime" },
      sensitive: false,
      public_message: `Hackatime timezone applied (${currentTimezone ?? "null"} -> ${tz})`,
      change_summary: "user_timezone_hackatime_sync",
    });
  } catch (err) {
    console.error("[hackatime-tz] writeAudit failed", err);
  }
  return tz;
}

export async function searchAdminUsersFuzzy(
  adminKey: string,
  query: string,
): Promise<HackatimeAdminFuzzySearchResponse["users"]> {
  return (await hackatimeAdminRequest<HackatimeAdminFuzzySearchResponse>(
    "/api/admin/v1/user/search_fuzzy",
    adminKey,
    {
      method: "POST",
      body: JSON.stringify({ query }),
      headers: {
        "Content-Type": "application/json",
      },
    },
    // Hackatime's admin search intermittently returns Cloudflare 520s; treat as no result.
    { quietStatusCodes: [404, 422, 520] },
  ))?.users ?? [];
}

export async function getAdminUserIdByEmail(
  adminKey: string,
  email: string,
): Promise<number | null> {
  const normalized = email.trim().toLowerCase();
  const match = (await searchAdminUsersFuzzy(adminKey, email)).find(
    (u) => (u.email ?? "").trim().toLowerCase() === normalized,
  );
  if (match?.id) return match.id;

  // `get_user_by_email` intermittently 520s in production, so it's only a fallback.
  return (await hackatimeAdminRequest<HackatimeAdminUserByEmailResponse>(
    "/api/admin/v1/user/get_user_by_email",
    adminKey,
    {
      method: "POST",
      body: JSON.stringify({ email: normalized }),
      headers: {
        "Content-Type": "application/json",
      },
    },
    { quietStatusCodes: [404, 520] },
  ))?.user_id ?? null;
}

export async function getTrustLevelForUser(
  input: HackatimeTrustLookupInput,
): Promise<string | null> {
  if (!input.adminKey) return null;

  if (input.userId) {
    const cached = readTrustCache(input.userId);
    if (cached) return cached.trustLevel;
  }

  let trustLookupHackatimeId = input.hackatimeId ?? null;

  if (!trustLookupHackatimeId && input.hackatimeOAuthToken) {
    trustLookupHackatimeId = (await getAuthenticatedMe(input.hackatimeOAuthToken))?.id ?? null;
  }

  let trustFactor: HackatimeTrustFactor | null = null;

  if (trustLookupHackatimeId) {
    trustFactor = await getAdminTrustFactorByUserId(
      input.adminKey,
      trustLookupHackatimeId,
    );
  }

  if (!trustFactor && input.email) {
    const emailLookupHackatimeId = await getAdminUserIdByEmail(
      input.adminKey,
      input.email,
    );

    if (emailLookupHackatimeId) {
      trustFactor = await getAdminTrustFactorByUserId(
        input.adminKey,
        emailLookupHackatimeId,
      );
    }
  }

  const trustLevel = trustFactor?.trust_level ?? null;
  if (input.userId) writeTrustCache(input.userId, trustLevel);
  return trustLevel;
}

export async function getAuthenticatedHours(
  accessToken: string,
  options?: { startDate?: string },
): Promise<HackatimeHoursResponse | null> {
  if (isDevFakeHackatimeToken(accessToken)) {
    return getFakeHackatimeHours(options);
  }

  const query = new URLSearchParams();
  // Only start_date is accepted (cumulative to now); per-day callers subtract consecutive days.
  if (options?.startDate) query.set("start_date", options.startDate);

  return hackatimeOAuthRequest<HackatimeHoursResponse>(
    `/api/v1/authenticated/hours${query.size > 0 ? `?${query.toString()}` : ""}`,
    accessToken,
  );
}

export async function getAuthenticatedProjects(
  accessToken: string,
  options?: {
    includeArchived?: boolean;
    startDate?: string;
  },
): Promise<HackatimeProjectsResponse | null> {
  let response: HackatimeProjectsResponse | null;
  if (isDevFakeHackatimeToken(accessToken)) {
    response = getFakeHackatimeProjects(options);
  } else {
    const query = new URLSearchParams();
    if (options?.includeArchived) query.set("include_archived", "true");
    if (options?.startDate) query.set("start_date", options.startDate);

    response = await hackatimeOAuthRequest<HackatimeProjectsResponse>(
      `/api/v1/authenticated/projects${query.size > 0 ? `?${query.toString()}` : ""}`,
      accessToken,
    );
  }
  if (!response) return null;

  // Every hour consumer reads through here; see server/lib/hackatime-placeholder.ts.
  return {
    ...response,
    projects: stripHackatimePlaceholderProjects(response.projects),
  };
}

export async function getLatestHeartbeat(
  accessToken: string,
): Promise<HackatimeLatestHeartbeatResponse | null> {
  if (isDevFakeHackatimeToken(accessToken)) return getFakeLatestHeartbeat();

  return hackatimeOAuthRequest<HackatimeLatestHeartbeatResponse>(
    "/api/v1/authenticated/heartbeats/latest",
    accessToken,
  );
}

function isRedTrustLevel(trustLevel: string | null | undefined): boolean {
  return (trustLevel ?? "").trim().toLowerCase() === "red";
}

export async function isHackatimeBanned(
  input: HackatimeTrustLookupInput,
): Promise<boolean> {
  if (!input.adminKey) return false;
  return isRedTrustLevel(await getTrustLevelForUser(input));
}

const inflightTrustRefresh = new Map<string, Promise<unknown>>();

// For per-request checks such as /api/auth/me: answers from the in-process or Redis cache and
// refreshes a miss in the background, so a slow Hackatime never delays the response. Fails open
// on a miss like isHackatimeBanned; the login callback still checks synchronously.
export async function isHackatimeBannedCached(
  input: HackatimeTrustLookupInput,
): Promise<boolean> {
  if (!input.adminKey) return false;
  if (!input.userId) return isHackatimeBanned(input);
  const userId = input.userId;

  const cached = await readTrustCacheShared(userId);
  if (cached && cached.expiresAt >= Date.now()) {
    trustCache.set(userId, cached);
    return isRedTrustLevel(cached.trustLevel);
  }

  if (!inflightTrustRefresh.has(userId)) {
    inflightTrustRefresh.set(
      userId,
      getTrustLevelForUser(input)
        .catch((err) => console.error("[hackatime] background trust refresh failed", userId, err))
        .finally(() => inflightTrustRefresh.delete(userId)),
    );
  }
  return false;
}

export async function getBannedUserIds(
  userIds: string[],
): Promise<Set<string>> {
  const banned = new Set<string>();
  if (userIds.length === 0) return banned;

  const config = useRuntimeConfig();
  const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;
  if (!adminKey) return banned;

  const misses: string[] = [];
  for (const id of Array.from(new Set(userIds))) {
    const cached = readTrustCache(id);
    if (cached) {
      if (isRedTrustLevel(cached.trustLevel)) banned.add(id);
    } else {
      misses.push(id);
    }
  }
  if (misses.length > 0) {
    const shared = await Promise.all(
      misses.map((id) => readTrustCacheShared(id)),
    );
    for (let i = 0; i < misses.length; i++) {
      const entry = shared[i];
      if (entry) {
        const id = misses[i]!;
        trustCache.set(id, entry);
        if (isRedTrustLevel(entry.trustLevel)) banned.add(id);
      }
    }
    for (let i = misses.length - 1; i >= 0; i--) {
      if (shared[i]) misses.splice(i, 1);
    }
  }

  if (misses.length === 0) return banned;

  const rows = await db
    .select({
      id: users.id,
      hackatime_id: users.hackatime_id,
      hackatime_oauth_token: users.hackatime_oauth_token,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, misses));

  const CONCURRENCY = 10;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (row) => {
        if (!row.hackatime_id && !row.hackatime_oauth_token && !row.email) {
          writeTrustCache(row.id, null);
          return;
        }
        try {
          const trustLevel = await getTrustLevelForUser({
            adminKey,
            hackatimeId: row.hackatime_id ?? null,
            hackatimeOAuthToken: row.hackatime_oauth_token ?? null,
            email: row.email ?? null,
            userId: row.id,
          });
          if (isRedTrustLevel(trustLevel)) banned.add(row.id);
        } catch (err) {
          console.error("[hackatime] getBannedUserIds lookup failed", row.id, err);
        }
      }),
    );
  }

  return banned;
}

export async function getTrustLevelsForUsers(
  userIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (userIds.length === 0) return out;

  const config = useRuntimeConfig();
  const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;
  if (!adminKey) {
    for (const id of userIds) out.set(id, null);
    return out;
  }

  const misses: string[] = [];
  for (const id of Array.from(new Set(userIds))) {
    const cached = readTrustCache(id);
    if (cached) {
      out.set(id, cached.trustLevel);
    } else {
      misses.push(id);
    }
  }
  if (misses.length > 0) {
    const shared = await Promise.all(
      misses.map((id) => readTrustCacheShared(id)),
    );
    for (let i = misses.length - 1; i >= 0; i--) {
      const entry = shared[i];
      if (entry) {
        const id = misses[i]!;
        trustCache.set(id, entry);
        out.set(id, entry.trustLevel);
        misses.splice(i, 1);
      }
    }
  }
  if (misses.length === 0) return out;

  const rows = await db
    .select({
      id: users.id,
      hackatime_id: users.hackatime_id,
      hackatime_oauth_token: users.hackatime_oauth_token,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, misses));

  const CONCURRENCY = 10;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (row) => {
        if (!row.hackatime_id && !row.hackatime_oauth_token && !row.email) {
          writeTrustCache(row.id, null);
          out.set(row.id, null);
          return;
        }
        try {
          const trustLevel = await getTrustLevelForUser({
            adminKey,
            hackatimeId: row.hackatime_id ?? null,
            hackatimeOAuthToken: row.hackatime_oauth_token ?? null,
            email: row.email ?? null,
            userId: row.id,
          });
          out.set(row.id, trustLevel);
        } catch (err) {
          console.error("[hackatime] getTrustLevelsForUsers lookup failed", row.id, err);
          out.set(row.id, null);
        }
      }),
    );
  }
  return out;
}

export async function revokeOAuthToken(params: {
  token: string;
  clientId: string;
  clientSecret?: string;
}): Promise<boolean> {
  const body = new URLSearchParams({
    token: params.token,
    client_id: params.clientId,
  });

  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  try {
    const res = await fetch(`${HACKATIME_URL}/oauth/revoke`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(
        `[hackatime] revokeOAuthToken failed: ${res.status} ${res.statusText}`,
      );
    }

    return res.ok;
  } catch (err) {
    console.error("[hackatime] revokeOAuthToken error:", err);
    return false;
  }
}
