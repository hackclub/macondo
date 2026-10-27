import { createError, defineEventHandler } from "h3";
import { getRoutedPath } from "../lib/request-path";
import { macondoHasEnded } from "../lib/macondo-end";

export default defineEventHandler((event) => {
  const path = getRoutedPath(event);
  const mcp = path === "/api/mcp" || path.startsWith("/api/mcp/")
    || path === "/api/oauth" || path.startsWith("/api/oauth/")
    || path === "/oauth" || path.startsWith("/oauth/")
    || path.startsWith("/.well-known/oauth-") || path === "/.well-known/openid-configuration"
    || path === "/internal/mcp" || path.startsWith("/api/internal/mcp/") || path === "/api/internal/mcp";
  if (mcp && process.env.MACONDO_MCP_ENABLED !== "1") {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  // The retired tutorial no longer needs a remote fetch proxy, general CDN
  // uploads, or permission to create/write participants' GitHub repositories.
  // Ticket attachments remain available through /api/support/uploads.
  const tutorial = path === "/api/proxy" || path === "/api/upload-image"
    || path === "/api/github" || path.startsWith("/api/github/")
    || path === "/api/auth/github" || path.startsWith("/api/auth/github/");
  if (tutorial && macondoHasEnded()) {
    throw createError({ statusCode: 410, statusMessage: "Tutorial integrations are closed because the event has ended" });
  }
});
