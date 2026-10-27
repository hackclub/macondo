import { writeAudit } from "../../../lib/audit";
import { createHcbClient, saveHcbOAuthConnection } from "../../../lib/hcb";
import { getSession } from "../../../lib/session";
import { canAccessInternalShopAdmin } from "../../../policies/internal";
import { HCB_URL } from "../../../lib/api-urls";

export default defineEventHandler(async (event) => {
  const actor = await getSession(event);
  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const code = typeof query.code === "string" ? query.code : "";
  const state = typeof query.state === "string" ? query.state : "";
  const storedState = getCookie(event, "hcb_oauth_state");
  deleteCookie(event, "hcb_oauth_state", { path: "/" });

  if (!code) {
    throw createError({ statusCode: 400, statusMessage: "Missing HCB authorization code" });
  }

  if (!state || !storedState || state !== storedState) {
    throw createError({
      statusCode: 403,
      statusMessage: "Invalid HCB OAuth state. Start again from /internal/hcb.",
    });
  }

  const config = useRuntimeConfig();
  const hcbApi = typeof config.hcbApi === "string" ? config.hcbApi : "";
  const clientId = typeof config.hcbOauthUid === "string" ? config.hcbOauthUid : "";
  const clientSecret =
    (typeof config.hcbOauthSecret === "string" && config.hcbOauthSecret) ||
    (!hcbApi.startsWith("hcb_") ? hcbApi : "");

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB OAuth UID or secret is not configured",
    });
  }

  const tokenRes = await $fetch<{
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
  }>(`${HCB_URL}/api/v4/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${getRequestURL(event).origin}/api/auth/hcb/callback`,
    }),
  });

  if (!tokenRes.access_token) {
    throw createError({
      statusCode: 400,
      statusMessage: "HCB did not return an access token",
    });
  }

  const hcbUser = await createHcbClient({ token: tokenRes.access_token }).getCurrentUser();

  await saveHcbOAuthConnection({
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token ?? null,
    tokenType: tokenRes.token_type ?? null,
    scope: tokenRes.scope ?? null,
    expiresIn: tokenRes.expires_in ?? null,
    connectedByUserId: actor.id,
    hcbUser,
  });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "connect_hcb_grants_oauth",
      entity_type: "internal_oauth_connection",
      entity_id: "hcb_grants",
      sensitive: true,
      public_message: "HCB grants OAuth connected",
      change_summary: hcbUser.email ?? hcbUser.id,
    });
  } catch (error) {
    console.error("Failed to write HCB OAuth connection audit log", error);
  }

  return sendRedirect(event, "/internal/hcb?hcb=connected");
});
