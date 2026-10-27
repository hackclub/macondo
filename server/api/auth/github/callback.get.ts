import { eq } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { getSession, invalidateSessionCache } from "~~/server/lib/session";
import { safeReturnTo } from "~~/server/lib/auth";
import { GITHUB_API_URL, GITHUB_URL } from "~~/server/lib/api-urls";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code as string | undefined;
  const state = query.state as string | undefined;
  const storedState = getCookie(event, "github_oauth_state");
  deleteCookie(event, "github_oauth_state", { path: "/" });

  if (!code) {
    throw createError({ statusCode: 400, statusMessage: "Missing authorization code" });
  }

  if (!state || !storedState || state !== storedState) {
    throw createError({ statusCode: 403, statusMessage: "Invalid OAuth state" });
  }

  const user = await getSession(event);
  // getSession just cached the pre-link row; invalidate it after the write (see hackatime callback).
  const sessionToken = getCookie(event, "macondo_session");

  if (!user) {
    return sendRedirect(event, "/onboarding?error=not_authenticated");
  }

  const config = useRuntimeConfig();

  const tokenRes = await $fetch<{
    access_token: string;
    token_type: string;
    scope: string;
  }>(`${GITHUB_URL}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: {
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
    },
  });

  console.log("[github/callback] Token response scope:", tokenRes.scope, "type:", tokenRes.token_type);

  if (!tokenRes.access_token) {
    // Scoped fields only: the response object must never ride into logs (or
    // monitoring) wholesale — a token-shaped field would leak a credential.
    console.error("[github/callback] No access token in response", {
      hasToken: false,
      tokenType: tokenRes.token_type,
      scope: tokenRes.scope,
    });
    throw createError({ statusCode: 400, statusMessage: "Failed to get GitHub access token" });
  }

  // Bind the token to a GitHub user id, or sign-in would accept any GitHub account.
  const ghUser = await $fetch<{ id: number; login: string }>(
    `${GITHUB_API_URL}/user`,
    {
      headers: {
        Authorization: `Bearer ${tokenRes.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "macondo",
      },
    },
  );

  if (!ghUser?.id) {
    throw createError({ statusCode: 400, statusMessage: "Failed to verify GitHub identity" });
  }

  await db
    .update(users)
    .set({ github_token: tokenRes.access_token, github_id: ghUser.id })
    .where(eq(users.id, user!.id));

  // Drop the stale cached session row so has_github flips on the next read.
  if (sessionToken) invalidateSessionCache(sessionToken);

  const returnTo = safeReturnTo(
    getCookie(event, "auth_return_to"),
    "/onboarding?github=connected",
  );
  deleteCookie(event, "auth_return_to", { path: "/" });
  return sendRedirect(event, returnTo);
});
