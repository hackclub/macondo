import { getInternalReauthStatus, setInternalReauthCookie } from "../../../lib/internal-reauth";

export default defineEventHandler((event) => {
  const actor = event.context.user;

  if (!getInternalReauthStatus(event, actor.id).verified) {
    throw createError({
      statusCode: 401,
      statusMessage: "Internal verification required",
    });
  }

  return {
    verified: true,
    expiresAt: setInternalReauthCookie(event, actor.id),
  };
});
