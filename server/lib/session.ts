import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import db from "../db";
import { referralVisitsTable, sessions, users } from "../db/schema";
import { resolveReferralCode } from "./referrals";
import type { H3Event } from "h3";

const SESSION_COOKIE = "macondo_session";
const IMPERSONATOR_SESSION_COOKIE = "macondo_impersonator_session";
const REFERRER_COOKIE = "macondo_ref";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Only hashes are accepted at rest. Matching the presented value directly
// would turn a stolen database hash into a usable bearer token.
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionTokenCondition(token: string) {
  return eq(sessions.token, hashSessionToken(token));
}

// Bounded in-process LRU: auth runs on every /internal* request and the sessions JOIN users query dominates it.
const SESSION_CACHE_TTL_MS = Number(
  process.env.SESSION_CACHE_TTL_MS ?? 5_000,
);
const SESSION_CACHE_MAX = Number(
  process.env.SESSION_CACHE_MAX ?? 2000,
);
type SessionCacheEntry = {
  user: typeof users.$inferSelect;
  cachedAt: number;
};
const sessionCache = new Map<string, SessionCacheEntry>();

function readSessionCache(token: string): typeof users.$inferSelect | null {
  const hit = sessionCache.get(token);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > SESSION_CACHE_TTL_MS) {
    sessionCache.delete(token);
    return null;
  }
  // Re-set moves the entry to the back of Map's insertion order (LRU touch).
  sessionCache.delete(token);
  sessionCache.set(token, hit);
  return hit.user;
}

function writeSessionCache(token: string, user: typeof users.$inferSelect): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    // Evict the oldest (first-inserted) entry.
    const first = sessionCache.keys().next().value;
    if (first !== undefined) sessionCache.delete(first);
  }
  sessionCache.set(token, { user, cachedAt: Date.now() });
}

export function invalidateSessionCache(token?: string): void {
  if (token) {
    sessionCache.delete(token);
    return;
  }
  sessionCache.clear();
}

function isSecureCookie(event: H3Event) {
  return process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:";
}

function getIpAddress(event: H3Event): string | null {
  const fwd = getHeader(event, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = getHeader(event, "x-real-ip");
  if (real) return real.trim();
  return event.node?.req?.socket?.remoteAddress ?? null;
}

function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000, // cookie maxAge is in seconds
  });
}

function setImpersonatorSessionCookie(event: H3Event, token: string) {
  setCookie(event, IMPERSONATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000, // cookie maxAge is in seconds
  });
}

export async function createSession(
  event: H3Event,
  userId: string,
  options: { applyReferralCookies?: boolean; isNewUser?: boolean } = {},
) {
  const token = randomBytes(48).toString("base64url");

  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    // Only the hash is persisted; the raw value lives solely in the cookie.
    token: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: getIpAddress(event),
    userAgent: getHeader(event, "user-agent") ?? null,
  });

  setSessionCookie(event, token);

  if (!(options.applyReferralCookies ?? true)) {
    return token;
  }

  const visitorCookie = getCookie(event, "macondo_rv");
  if (visitorCookie) {
    void db
      .update(referralVisitsTable)
      .set({ user_id: userId })
      .where(
        and(
          eq(referralVisitsTable.visitor_cookie, visitorCookie),
          isNull(referralVisitsTable.user_id),
        ),
      )
      .catch((err) => {
        console.error("[referral-capture] backfill failed", err);
      });
  }

  // Only brand-new users get a referral, or an attacker could credit themselves for any
  // existing user who clicks ?ref=<code>. The cookie is always cleared.
  const refCookie = getCookie(event, REFERRER_COOKIE);
  if (refCookie) {
    deleteCookie(event, REFERRER_COOKIE, { path: "/" });
    if (options.isNewUser) {
      void (async () => {
        try {
          const existing = await db
            .select({ referred_by_user_id: users.referred_by_user_id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          if (existing[0]?.referred_by_user_id) return;
          const referrerId = await resolveReferralCode(refCookie, userId);
          if (!referrerId) return;
          await db
            .update(users)
            .set({
              referred_by_user_id: referrerId,
              referred_at: new Date(),
            })
            .where(and(eq(users.id, userId), isNull(users.referred_by_user_id)));
        } catch (err) {
          console.error("[referrals] resolve on signin failed", err);
        }
      })();
    }
  }

  return token;
}

export async function getSession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE);
  if (token) return await getSessionByToken(token);

  // API key fallback, stashed only by server/middleware/1.api-key.ts, which owns the access policy.
  return (
    event.context.apiKeyAuth as import("./api-keys").ApiKeyAuth | undefined
  )?.user ?? null;
}

// A page render fires several API calls at once; on a cold cache each would run its own
// identical session query, so concurrent lookups for one token share a single query.
const inflightSessionLookups = new Map<string, Promise<typeof users.$inferSelect | null>>();

export async function getSessionByToken(token: string) {
  const cached = readSessionCache(token);
  if (cached) return cached;

  const pending = inflightSessionLookups.get(token);
  if (pending) return pending;
  const lookup = loadSessionByToken(token).finally(() => {
    inflightSessionLookups.delete(token);
  });
  inflightSessionLookups.set(token, lookup);
  return lookup;
}

async function loadSessionByToken(token: string) {
  const rows = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        sessionTokenCondition(token),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const user = rows[0]!.users;
  writeSessionCache(token, user);
  return user;
}

export async function getImpersonatorSession(event: H3Event) {
  const token = getCookie(event, IMPERSONATOR_SESSION_COOKIE);
  if (!token) return null;

  const user = await getSessionByToken(token);
  if (!user) {
    deleteCookie(event, IMPERSONATOR_SESSION_COOKIE, { path: "/" });
    return null;
  }

  return user;
}

export async function beginImpersonation(event: H3Event, targetUserId: string) {
  const currentToken = getCookie(event, SESSION_COOKIE);
  if (!currentToken) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const impersonatorToken =
    getCookie(event, IMPERSONATOR_SESSION_COOKIE) ?? currentToken;

  await createSession(event, targetUserId, { applyReferralCookies: false });
  setImpersonatorSessionCookie(event, impersonatorToken);
}

export async function stopImpersonation(event: H3Event) {
  const impersonatorToken = getCookie(event, IMPERSONATOR_SESSION_COOKIE);
  if (!impersonatorToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "No active impersonation session",
    });
  }

  const impersonator = await getSessionByToken(impersonatorToken);
  if (!impersonator) {
    deleteCookie(event, IMPERSONATOR_SESSION_COOKIE, { path: "/" });
    invalidateSessionCache(impersonatorToken);
    throw createError({
      statusCode: 401,
      statusMessage: "Impersonator session expired",
    });
  }

  const currentToken = getCookie(event, SESSION_COOKIE);
  if (currentToken && currentToken !== impersonatorToken) {
    await db.delete(sessions).where(sessionTokenCondition(currentToken));
    invalidateSessionCache(currentToken);
  }

  setSessionCookie(event, impersonatorToken);
  deleteCookie(event, IMPERSONATOR_SESSION_COOKIE, { path: "/" });

  return impersonator;
}

export async function destroySession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(sessionTokenCondition(token));
    invalidateSessionCache(token);
  }
  const impersonatorToken = getCookie(event, IMPERSONATOR_SESSION_COOKIE);
  if (impersonatorToken && impersonatorToken !== token) {
    await db.delete(sessions).where(sessionTokenCondition(impersonatorToken));
    invalidateSessionCache(impersonatorToken);
  }
  deleteCookie(event, SESSION_COOKIE, { path: "/" });
  deleteCookie(event, IMPERSONATOR_SESSION_COOKIE, { path: "/" });
}
