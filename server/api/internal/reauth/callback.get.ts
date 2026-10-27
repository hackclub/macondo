import {
  clearInternalReauthReturnTo,
  consumeInternalReauthState,
  exchangeInternalReauthCode,
  fetchInternalReauthUserInfo,
  getInternalReauthReturnTo,
  setInternalReauthCookie,
} from "../../../lib/internal-reauth";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const query = getQuery(event);
  const code = typeof query.code === "string" ? query.code : "";
  const state = typeof query.state === "string" ? query.state : "";
  const storedState = consumeInternalReauthState(event);

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing Hack Club Auth authorization code",
    });
  }

  if (!state || !storedState || state !== storedState) {
    throw createError({
      statusCode: 403,
      statusMessage: "Invalid Hack Club Auth state",
    });
  }

  let tokenRes: Awaited<ReturnType<typeof exchangeInternalReauthCode>>;
  try {
    tokenRes = await exchangeInternalReauthCode(event, code);
  } catch (err) {
    console.error(
      "[reauth/callback] token exchange failed:",
      (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { statusCode?: number; status?: number })?.status
        ?? "",
      (err as { message?: string })?.message ?? "unknown error",
    );
    throw createError({
      statusCode: 502,
      statusMessage: "Hack Club Auth is temporarily unavailable. Please try again.",
    });
  }

  if (!tokenRes.access_token) {
    throw createError({
      statusCode: 400,
      statusMessage: "Hack Club Auth did not return an access token",
    });
  }

  const userInfo = await fetchInternalReauthUserInfo(tokenRes.access_token);
  const actorEmail = actor.email?.trim().toLowerCase();
  const userInfoEmail = userInfo.email?.trim().toLowerCase();
  const sameHackClubAccount = actor.sub
    ? actor.sub === userInfo.sub
    : !!actorEmail && !!userInfoEmail && actorEmail === userInfoEmail;

  if (!sameHackClubAccount) {
    throw createError({
      statusCode: 403,
      statusMessage: "Hack Club Auth returned a different account",
    });
  }

  setInternalReauthCookie(event, actor.id);
  const returnTo = getInternalReauthReturnTo(event);
  clearInternalReauthReturnTo(event);

  return sendRedirect(event, returnTo);
});
