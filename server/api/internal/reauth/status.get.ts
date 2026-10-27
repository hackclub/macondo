import { getInternalReauthStatus } from "../../../lib/internal-reauth";

export default defineEventHandler((event) => {
  const status = getInternalReauthStatus(event, event.context.user.id);

  return {
    verified: status.verified,
    expiresAt: status.expiresAt,
  };
});
