import { createError, defineEventHandler, getCookie } from "h3";
import { getSession } from "../lib/session";
import { getActiveMacondoBan } from "../lib/macondo-ban";
import { getRoutedPath } from "../lib/request-path";

export default defineEventHandler(async (event) => {
  const path = getRoutedPath(event);
  if (!path.startsWith("/api/") || !getCookie(event, "macondo_session")) return;
  // me supplies the ban explanation; session cleanup must stay available.
  if (["/api/auth/me", "/api/auth/logout", "/api/auth/impersonation/stop"].includes(path)) return;
  const user = await getSession(event);
  if (user && await getActiveMacondoBan(user.id)) {
    throw createError({ statusCode: 403, statusMessage: "Account banned" });
  }
});
