import { macondoHasEnded } from "../../lib/macondo-end";
import { randomUUID } from "node:crypto";
import { enqueuePageview } from "../../lib/analytics/ingest";
import {
  bucketScreenSize,
  isBot,
  parseUserAgent,
} from "../../lib/analytics/user-agent";
import { classifySource } from "../../lib/analytics/source";

// No DB work on the request path; the flusher in lib/analytics/ingest bulk-inserts.
// This is the only way SPA navigations get recorded.

const VISITOR_COOKIE = "macondo_rv";

// Defense in depth: the client already skips these paths.
const SKIP_PREFIXES = ["/api", "/internal", "/_nuxt", "/_ipx", "/__nuxt", "/_fonts", "/_scripts"];
const SKIP_EXTS = [
  ".js", ".mjs", ".css", ".map", ".ico", ".png", ".jpg", ".jpeg",
  ".webp", ".svg", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".otf",
  ".json", ".xml", ".txt", ".mp4", ".webm",
];

const MAX_PATH_LEN = 512;
const MAX_UTM_LEN = 255;

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export default defineEventHandler(async (event) => {
  if (macondoHasEnded()) {
    setResponseStatus(event, 204);
    return null;
  }

  const requestUrl = getRequestURL(event);

  // Every exit path returns 204; the beacon ignores the body either way.
  const noContent = () => {
    setResponseStatus(event, 204);
    return null;
  };

  // Reject cross-origin posts; a missing Origin is allowed since the bot filter and buffer cap bound abuse.
  const origin = getHeader(event, "origin");
  if (origin) {
    try {
      if (new URL(origin).host !== requestUrl.host) return noContent();
    } catch {
      return noContent();
    }
  }

  const userAgent = getHeader(event, "user-agent") ?? null;
  if (isBot(userAgent)) return noContent();

  const body = await readBody(event).catch(() => null);
  const rawUrl = clean(body?.u, MAX_PATH_LEN + 256);
  if (!rawUrl) return noContent();

  let pathname: string;
  let params: URLSearchParams;
  try {
    const parsed = new URL(rawUrl, requestUrl.origin);
    pathname = parsed.pathname;
    params = parsed.searchParams;
  } catch {
    return noContent();
  }
  if (!pathname.startsWith("/")) return noContent();
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return noContent();
  if (SKIP_EXTS.some((ext) => pathname.endsWith(ext))) return noContent();
  pathname = pathname.slice(0, MAX_PATH_LEN);

  const utmSource = clean(params.get("utm_source"), MAX_UTM_LEN);

  // Drop same-origin referrers so in-app navigation never pollutes the Sources panel.
  let referrerHost: string | null = null;
  const rawReferrer = clean(body?.r, 2048); // max referrer length
  if (rawReferrer) {
    try {
      const refHost = new URL(rawReferrer).hostname || null;
      if (refHost && refHost !== requestUrl.hostname) referrerHost = refHost;
    } catch {
      referrerHost = null;
    }
  }

  const source = classifySource({ refererHost: referrerHost, utmSource });

  // Country from Cloudflare. "XX" (unknown) and "T1" (Tor) are not real codes.
  let country: string | null = null;
  const cf = getHeader(event, "cf-ipcountry");
  if (cf && /^[A-Za-z]{2}$/.test(cf) && cf.toUpperCase() !== "XX") {
    country = cf.toUpperCase();
  }

  const { browser, os, deviceType } = parseUserAgent(userAgent);
  const widthRaw = typeof body?.w === "number" ? body.w : Number(body?.w);
  const screenSize = bucketScreenSize(Number.isFinite(widthRaw) ? widthRaw : null);

  // Reuse the referral tracker's visitor cookie so uniques line up.
  let visitorId = getCookie(event, VISITOR_COOKIE) ?? null;
  if (!visitorId) {
    visitorId = randomUUID();
    setCookie(event, VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || requestUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 180 * 24 * 60 * 60, // visitor cookie ttl, 180 days
    });
  }

  enqueuePageview({
    sessionToken: getCookie(event, "macondo_session") ?? null,
    visitor_id: visitorId,
    pathname,
    referrer_host: referrerHost,
    source,
    utm_source: utmSource,
    utm_medium: clean(params.get("utm_medium"), MAX_UTM_LEN),
    utm_campaign: clean(params.get("utm_campaign"), MAX_UTM_LEN),
    utm_term: clean(params.get("utm_term"), MAX_UTM_LEN),
    utm_content: clean(params.get("utm_content"), MAX_UTM_LEN),
    country,
    browser,
    os,
    device_type: deviceType,
    screen_size: screenSize,
  });

  return noContent();
});
