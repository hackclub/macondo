import { createInternalReauthAuthorizationUrl } from "../../../lib/internal-reauth";

export default defineEventHandler((event) => {
  const returnTo = typeof getQuery(event).return_to === "string"
    ? getQuery(event).return_to as string
    : "/internal/dashboard";

  return sendRedirect(event, createInternalReauthAuthorizationUrl(event, returnTo));
});
