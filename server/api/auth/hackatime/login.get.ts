import { randomBytes } from "node:crypto";
import { safeReturnTo } from "~~/server/lib/auth";
import { HACKATIME_URL } from "~~/server/lib/api-urls";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const hackatimeOAuthClientId =
    config.hackatimeOauthUid as string | undefined;

  // Validate here so a hostile `?return_to=https://evil.com` never gets persisted.
  const returnTo = safeReturnTo(getQuery(event).return_to as string | undefined, "");
  if (returnTo) {
    setCookie(event, "auth_return_to", returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // seconds, 10 minutes
    });
  }

  const state = randomBytes(32).toString("base64url");
  setCookie(event, "hackatime_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // seconds, 10 minutes
  });

  if (!hackatimeOAuthClientId) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hackatime OAuth is not configured: missing client ID",
    });
  }

  const params = new URLSearchParams({
    client_id: hackatimeOAuthClientId,
    redirect_uri: `${getRequestURL(event).origin}/api/auth/hackatime/callback`,
    response_type: "code",
    scope: "profile read",
    state,
  });
  const authorizeUrl = `${HACKATIME_URL}/oauth/authorize?${params.toString()}`;


  return sendRedirect(
    event,
    authorizeUrl,
  );
});
