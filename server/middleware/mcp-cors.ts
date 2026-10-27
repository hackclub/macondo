// claude.ai calls these from a browser origin; they're token-authenticated (no cookies), so `*` is safe.
// Discovery docs are served here, not as .well-known route files, so dotfile routing can't drop them.
import {
  authServerMetadata,
  baseUrl,
  protectedResourceMetadata,
} from "../lib/mcp/oauth";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function isMcpPath(p: string): boolean {
  return (
    p.startsWith("/api/mcp") ||
    p.startsWith("/oauth/") ||
    p.startsWith("/.well-known/")
  );
}

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (!isMcpPath(path)) return;

  for (const [k, v] of Object.entries(CORS)) setResponseHeader(event, k, v);

  if (getMethod(event) === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }

  const origin = baseUrl(getRequestURL(event).origin);
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return protectedResourceMetadata(origin);
  }
  if (
    path.startsWith("/.well-known/oauth-authorization-server") ||
    path === "/.well-known/openid-configuration"
  ) {
    return authServerMetadata(origin);
  }
});
