import { randomBytes } from "node:crypto";
import { HCB_URL } from "../../../lib/api-urls";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const clientId = typeof config.hcbOauthUid === "string" ? config.hcbOauthUid : "";
  const scope =
    typeof config.hcbOauthScope === "string" && config.hcbOauthScope.trim().length > 0
      ? config.hcbOauthScope.trim()
      : "read write";

  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB_UID is not configured",
    });
  }

  const redirectUri = `${getRequestURL(event).origin}/api/auth/hcb/callback`;
  const state = randomBytes(24).toString("hex");

  setCookie(event, "hcb_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
  });

  return sendRedirect(event, `${HCB_URL}/api/v4/oauth/authorize?${params.toString()}`);
});
