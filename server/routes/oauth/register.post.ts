// RFC 7591 DCR. Public PKCE client, so nothing is persisted; the token endpoint ignores client_id.
import { randomBytes } from "node:crypto";

import { mlog } from "../../lib/mcp/log";

export default defineEventHandler(async (event) => {
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const clientId = `macondo-mcp-${randomBytes(8).toString("hex")}`;
  mlog("oauth", "register (DCR)", { client_id: clientId, redirect_uris: redirectUris });
  setResponseStatus(event, 201);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000), // ms to unix seconds
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_name: typeof body.client_name === "string" ? body.client_name : "MCP Client",
  };
});
