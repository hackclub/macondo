import { randomBytes } from "node:crypto";
import { safeReturnTo } from "~~/server/lib/auth";
import { GITHUB_URL } from "~~/server/lib/api-urls";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();

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
  setCookie(event, "github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // seconds, 10 minutes
  });

  const params = new URLSearchParams({
    client_id: config.githubClientId as string,
    redirect_uri: `${getRequestURL(event).origin}/api/auth/github/callback`,
    scope: "public_repo",
    state,
  });

  return sendRedirect(
    event,
    `${GITHUB_URL}/login/oauth/authorize?${params.toString()}`,
  );
});
