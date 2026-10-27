// Friction, NOT an authorization boundary: real gates are enforced server-side and a copied browser
// request gets through. It does stop naive cookie replays and cross-site abuse.

import type { H3Event } from "h3";

function normalizeOrigin(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  // Browsers send "null" for opaque origins, never one the shop posts from.
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

// Config only, NEVER the request's Host/X-Forwarded-Host, or a forged Host + Origin pair would validate itself.
function allowedOrigins(): Set<string> {
  const origins = new Set<string>(["https://macondo.hackclub.com"]);

  for (const candidate of [
    process.env.NUXT_PUBLIC_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    // Comma-separated escape hatch for preview/staging deploys.
    ...(process.env.MACONDO_EXTRA_ALLOWED_ORIGINS ?? "").split(","),
  ]) {
    const origin = normalizeOrigin(candidate);
    if (origin) origins.add(origin);
  }

  // Dev servers move ports constantly; pinning them here would just mean a
  // broken local shop. Production is unaffected.
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

export function isAllowedOrigin(raw: string | null | undefined): boolean {
  const origin = normalizeOrigin(raw);
  return origin !== null && allowedOrigins().has(origin);
}

export function isFirstPartyRequest(event: H3Event): boolean {
  if (process.env.MACONDO_FIRST_PARTY_CHECK_DISABLED === "1") return true;

  // Page JS can't set Sec-Fetch-*, and the shop's own fetch() is always "same-origin".
  const fetchSite = getHeader(event, "sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite) return fetchSite === "same-origin";

  // Fallback for browsers without Fetch Metadata (Safari < 16.4); a missing Origin means a non-browser client.
  const origin = normalizeOrigin(getHeader(event, "origin"));
  if (!origin) return false;
  return allowedOrigins().has(origin);
}

export function assertFirstPartyRequest(event: H3Event): void {
  if (isFirstPartyRequest(event)) return;
  throw createError({
    statusCode: 403,
    statusMessage:
      "This action has to be done from the Macondo shop in your browser.",
  });
}
