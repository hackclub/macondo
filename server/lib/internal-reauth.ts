import { $fetch } from "ofetch";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { safeReturnTo } from "./auth";
import { HACK_CLUB_AUTH_URL } from "./api-urls";

const INTERNAL_REAUTH_COOKIE = "macondo_internal_reauth";
const INTERNAL_REAUTH_STATE_COOKIE = "macondo_internal_reauth_state";
const INTERNAL_REAUTH_RETURN_TO_COOKIE = "macondo_internal_reauth_return_to";
const INTERNAL_REAUTH_TTL_MS = 10 * 60 * 1000;
const INTERNAL_REAUTH_SCOPES = ["openid", "profile", "email"];

function isSecureCookie(event: H3Event) {
  return process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:";
}

function getInternalReauthSecret() {
  const config = useRuntimeConfig();
  const secret = config.hackclubAuthClientSecret;

  if (typeof secret !== "string" || !secret.trim()) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hack Club Auth is not configured.",
    });
  }

  return secret;
}

// Key separation: derive a purpose-bound key instead of HMACing with the
// OAuth client secret itself, so the cookie signature and the OAuth code
// exchange never share a key and one can't be replayed as the other.
function getInternalReauthSigningKey() {
  return createHash("sha256")
    .update(getInternalReauthSecret())
    .update("macondo:internal-reauth-cookie:v1")
    .digest();
}

function signInternalReauthPayload(payload: string) {
  return createHmac("sha256", getInternalReauthSigningKey()).update(payload).digest("base64url");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getInternalReauthReturnTo(event: H3Event, fallback = "/internal/dashboard") {
  const query = getQuery(event);

  return safeReturnTo(
    typeof query.return_to === "string" ? query.return_to : getCookie(event, INTERNAL_REAUTH_RETURN_TO_COOKIE),
    fallback,
  );
}

export function setInternalReauthReturnTo(event: H3Event, returnTo: string) {
  const safePath = safeReturnTo(returnTo, "/internal/dashboard");

  setCookie(event, INTERNAL_REAUTH_RETURN_TO_COOKIE, safePath, {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return safePath;
}

export function clearInternalReauthReturnTo(event: H3Event) {
  deleteCookie(event, INTERNAL_REAUTH_RETURN_TO_COOKIE, { path: "/" });
}

export function createInternalReauthAuthorizationUrl(event: H3Event, returnTo: string) {
  const config = useRuntimeConfig();
  const clientId = config.hackclubAuthClientId as string | undefined;

  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hack Club Auth is not configured. Missing client ID.",
    });
  }

  const redirectUri = `${getRequestURL(event).origin}/api/internal/reauth/callback`;
  const state = randomBytes(32).toString("base64url");

  setCookie(event, INTERNAL_REAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  setInternalReauthReturnTo(event, returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: INTERNAL_REAUTH_SCOPES.join(" "),
    prompt: "login",
    state,
  });

  return `${HACK_CLUB_AUTH_URL}/oauth/authorize?${params.toString()}`;
}

export async function exchangeInternalReauthCode(event: H3Event, code: string) {
  const config = useRuntimeConfig();
  const clientId = config.hackclubAuthClientId as string | undefined;
  const clientSecret = config.hackclubAuthClientSecret as string | undefined;
  const redirectUri = `${getRequestURL(event).origin}/api/internal/reauth/callback`;

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hack Club Auth is not configured.",
    });
  }

  return await $fetch<{
    access_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
  }>(`${HACK_CLUB_AUTH_URL}/oauth/token`, {
    method: "POST",
    body: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    },
  });
}

export async function fetchInternalReauthUserInfo(accessToken: string) {
  return await $fetch<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  }>(`${HACK_CLUB_AUTH_URL}/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function consumeInternalReauthState(event: H3Event) {
  const state = getCookie(event, INTERNAL_REAUTH_STATE_COOKIE);
  deleteCookie(event, INTERNAL_REAUTH_STATE_COOKIE, { path: "/" });
  return state;
}

export function setInternalReauthCookie(event: H3Event, userId: string) {
  const expiresAt = Date.now() + INTERNAL_REAUTH_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  setCookie(event, INTERNAL_REAUTH_COOKIE, `${payload}.${signInternalReauthPayload(payload)}`, {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: INTERNAL_REAUTH_TTL_MS / 1000,
  });

  return expiresAt;
}

export function clearInternalReauthCookie(event: H3Event) {
  deleteCookie(event, INTERNAL_REAUTH_COOKIE, { path: "/" });
}

export function getInternalReauthStatus(event: H3Event, expectedUserId?: string) {
  // Fail closed: only an explicit development build may skip the step-up
  // round-trip. Staging/preview/test deployments must verify for real, or a
  // NODE_ENV typo would disarm the gate for every staff surface.
  if (process.env.NODE_ENV === "development") {
    return { verified: true as const, expiresAt: Date.now() + INTERNAL_REAUTH_TTL_MS };
  }

  const raw = getCookie(event, INTERNAL_REAUTH_COOKIE);

  if (!raw) {
    return { verified: false as const, expiresAt: null };
  }

  const status = verifyInternalReauthCookie(raw, expectedUserId);
  if (!status.verified) clearInternalReauthCookie(event);
  return status;
}

// Also used by WebSocket authentication, where there is no h3 event.
export function verifyInternalReauthCookie(raw: string | null, expectedUserId?: string) {
  const unverified = { verified: false as const, expiresAt: null };
  if (!raw) return unverified;
  const parts = raw.split(".");
  if (parts.length !== 3) return unverified;
  const [userId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !expiresAtRaw || !signature || !Number.isFinite(expiresAt)) return unverified;
  if (expectedUserId && userId !== expectedUserId) return unverified;
  if (expiresAt <= Date.now()) return unverified;
  if (!constantTimeEquals(signature, signInternalReauthPayload(`${userId}.${expiresAtRaw}`))) return unverified;
  return { verified: true as const, expiresAt };
}

export function requiresInternalReauth(path: string) {
  if (path === "/internal/verify") return false;
  if (path.startsWith("/api/internal/reauth")) return false;
  return path.startsWith("/internal") || path.startsWith("/api/internal");
}

export function getInternalReauthRedirect(path: string) {
  return `/internal/verify?return_to=${encodeURIComponent(path)}`;
}
