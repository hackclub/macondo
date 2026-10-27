import { randomBytes } from "node:crypto";

import {
  getAuthorizationUrl,
  HACK_CLUB_AUTH_SCOPES,
  safeReturnTo,
} from "../../../lib/auth";
import { getSession } from "../../../lib/session";

export default defineEventHandler(async (event) => {
  if (!(await getSession(event))) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const config = useRuntimeConfig();
  const baseUrl = getRequestURL(event).origin;
  const clientId = config.hackclubAuthClientId as string | undefined;

  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hack Club Auth is not configured. Missing client ID.",
    });
  }

  // Same-origin relative paths only (safeReturnTo), so the post-OAuth
  // redirect can't be aimed at a hostile origin.
  setCookie(event, "shop_address_return_to", safeReturnTo((getQuery(event).return_to as string | undefined) ?? null, "/shop"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
  });

  const state = randomBytes(32).toString("base64url");
  setCookie(event, "shop_address_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
    sameSite: "lax",
    path: "/",
  });

  const authorizationUrl = getAuthorizationUrl(clientId, `${baseUrl}/api/shop/address/callback`, {
    scopes: [
      HACK_CLUB_AUTH_SCOPES.basicInfo,
      HACK_CLUB_AUTH_SCOPES.address,
    ],
    prompt: "login",
  });

  const urlWithState = new URL(authorizationUrl);
  urlWithState.searchParams.set("state", state);

  return sendRedirect(event, urlWithState.toString());
});
