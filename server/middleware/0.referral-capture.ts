import { macondoHasEnded } from "../lib/macondo-end";
import { randomUUID } from "node:crypto";
import { and, gt, inArray } from "drizzle-orm";
import type { H3Event } from "h3";
import db from "../db";
import { referralVisitsTable, sessions } from "../db/schema";
import { hashSessionToken } from "../lib/session";
import { normalizeCode } from "../lib/referrals";

const VISITOR_COOKIE = "macondo_rv";

const SKIP_PREFIXES = [
  "/api/",
  "/_nuxt/",
  "/_nuxt",
  "/_ipx/",
  "/__nuxt",
  "/__nitro",
  "/_fonts/",
  "/_scripts/",
];

const SKIP_EXACT = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
]);

const SKIP_EXTS = [
  ".js", ".mjs", ".css", ".map", ".ico", ".png", ".jpg", ".jpeg",
  ".webp", ".svg", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".otf",
  ".json", ".xml", ".txt", ".mp4", ".webm",
];

// present only when returning from an auth provider, whose referer would pollute source stats
const AUTH_CALLBACK_PARAMS = [
  "github",    // /onboarding?github=connected
  "hackatime", // /onboarding?hackatime=denied
  "hcb",       // /internal/hcb?hcb=connected
  "code",      // OAuth 2.0 standard (?code=..&state=..)
  "state",     // OAuth 2.0 standard
];

function isAuthCallbackReturn(params: URLSearchParams): boolean {
  for (const p of AUTH_CALLBACK_PARAMS) {
    if (params.has(p)) return true;
  }
  // "from" is reused elsewhere (e.g. ?from=fade), so only match our Hackatime callback's value
  if (params.get("from") === "auth") return true;
  return false;
}

function getIpAddress(event: H3Event): string | null {
  const fwd = getHeader(event, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = getHeader(event, "x-real-ip");
  if (real) return real.trim();
  return event.node?.req?.socket?.remoteAddress ?? null;
}

// buffered in-process and bulk-flushed to keep this hot path to an array push;
// visits buffered at process exit are dropped, which is acceptable for analytics
type PendingReferralVisit = {
  sessionToken: string | null;
  visitor_cookie: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referer: string | null;
  referer_host: string | null;
  landing_path: string;
  user_agent: string | null;
  ip_address: string | null;
};

const pendingReferralVisits: PendingReferralVisit[] = [];
let referralFlushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueReferralVisit(visit: PendingReferralVisit): void {
  pendingReferralVisits.push(visit);
  // bounds memory under a traffic spike
  if (pendingReferralVisits.length >= 500) { // max buffered visits before flushing
    void flushReferralVisits();
    return;
  }
  if (!referralFlushTimer) {
    referralFlushTimer = setTimeout(() => {
      referralFlushTimer = null;
      void flushReferralVisits();
    }, 5_000); // flush interval
  }
}

async function flushReferralVisits(): Promise<void> {
  if (pendingReferralVisits.length === 0) return;
  const batch = pendingReferralVisits.splice(0, pendingReferralVisits.length);
  try {
    const tokens = [
      ...new Set(
        batch
          .map((v) => v.sessionToken)
          .filter((t): t is string => typeof t === "string" && t.length > 0),
      ),
    ];
    const tokenToUserId = new Map<string, string>();
    if (tokens.length > 0) {
      // Match only the hash, just like the session authentication path.
      const hashed = tokens.map((t) => hashSessionToken(t));
      const rows = await db
        .select({ token: sessions.token, userId: sessions.userId })
        .from(sessions)
        .where(
          and(
            inArray(sessions.token, hashed),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      const hashToRaw = new Map(hashed.map((h, i) => [h, tokens[i]!]));
      for (const r of rows) {
        const raw = hashToRaw.get(r.token);
        if (raw) tokenToUserId.set(raw, r.userId); // hashed row
      }
    }
    await db.insert(referralVisitsTable).values(
      batch.map((v) => ({
        visitor_cookie: v.visitor_cookie,
        user_id: v.sessionToken
          ? tokenToUserId.get(v.sessionToken) ?? null
          : null,
        utm_source: v.utm_source,
        utm_medium: v.utm_medium,
        utm_campaign: v.utm_campaign,
        utm_term: v.utm_term,
        utm_content: v.utm_content,
        referer: v.referer,
        referer_host: v.referer_host,
        landing_path: v.landing_path,
        user_agent: v.user_agent,
        ip_address: v.ip_address,
      })),
    );
  } catch (err) {
    console.error("[referral-capture] bulk insert failed", err);
  }
}

export default defineEventHandler(async (event) => {
  if (macondoHasEnded()) return;
  if (event.method !== "GET") return;

  const url = getRequestURL(event);
  const path = url.pathname;

  if (SKIP_EXACT.has(path)) return;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
  if (SKIP_EXTS.some((ext) => path.endsWith(ext))) return;

  const params = url.searchParams;

  if (isAuthCallbackReturn(params)) return;
  const utmSource = params.get("utm_source");
  const utmMedium = params.get("utm_medium");
  const utmCampaign = params.get("utm_campaign");
  const utmTerm = params.get("utm_term");
  const utmContent = params.get("utm_content");

  // separate cookie from the visitor cookie so it survives until the user signs up
  const refCode = normalizeCode(params.get("ref"));
  if (refCode) {
    setCookie(event, "macondo_ref", refCode, {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production" ||
        url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 180 * 24 * 60 * 60, // referral code cookie lasts 180 days
    });
  }

  const referer = getHeader(event, "referer") ?? null;
  let refererHost: string | null = null;
  let externalReferer = false;
  if (referer) {
    try {
      refererHost = new URL(referer).hostname || null;
      externalReferer = !!refererHost && refererHost !== url.hostname;
    } catch {
      refererHost = null;
    }
  }

  let visitorCookie = getCookie(event, VISITOR_COOKIE) ?? null;
  const freshCookie = !visitorCookie;
  if (!visitorCookie) {
    visitorCookie = randomUUID();
    setCookie(event, VISITOR_COOKIE, visitorCookie, {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production" ||
        url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 180 * 24 * 60 * 60, // visitor cookie lasts 180 days
    });
  }

  if (!(utmSource || utmMedium || utmCampaign || utmTerm || utmContent) && !externalReferer && !freshCookie) return;

  enqueueReferralVisit({
    sessionToken: getCookie(event, "macondo_session") ?? null,
    visitor_cookie: visitorCookie,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_term: utmTerm,
    utm_content: utmContent,
    referer,
    referer_host: refererHost,
    landing_path: path,
    user_agent: getHeader(event, "user-agent") ?? null,
    ip_address: getIpAddress(event),
  });
});
