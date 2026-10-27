import { createError, defineEventHandler, getCookie, getHeader, setResponseHeader } from "h3";
import { isAllowedOrigin } from "../lib/first-party";
import { getRoutedPath } from "../lib/request-path";
import { limitRequestBody } from "../lib/request-body";

export default defineEventHandler(async (event) => {
  const path = getRoutedPath(event);
  if (path.startsWith("/api/") || path.startsWith("/oauth/")) {
    // APIs mix private/session-specific data and public responses. Cache only
    // where a handler explicitly opts into a public projection (e.g. OG PNGs).
    setResponseHeader(event, "cache-control", "private, no-store");
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(event.method)) return;

  // Inbound webhooks and bearer-only protocols do not use ambient cookies.
  const independentAuth = path.startsWith("/api/webhooks/") || path === "/api/mcp" || path.startsWith("/api/mcp/") || path === "/oauth/token" || path === "/oauth/register";
  if (!independentAuth && getCookie(event, "macondo_session")) {
    const origin = getHeader(event, "origin");
    const site = getHeader(event, "sec-fetch-site");
    if ((origin && !isAllowedOrigin(origin)) || (site && site !== "same-origin") || (!origin && site !== "same-origin")) {
      throw createError({ statusCode: 403, statusMessage: "Cross-origin request rejected" });
    }
  }

  // Multipart includes boundaries/field headers in addition to the file cap.
  const maxBytes = path === "/api/upload-image" ? 51 * 1024 * 1024
    : path === "/api/support/uploads" ? 26 * 1024 * 1024 : 1024 * 1024;
  await limitRequestBody(event, maxBytes);
});
