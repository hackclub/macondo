// Stateless mode has no SSE stream to push, so decline rather than hold the GET open.
import { mlog } from "../../lib/mcp/log";

export default defineEventHandler((event) => {
  mlog("api", "GET /api/mcp -> 405 (no SSE in stateless mode)");
  setResponseStatus(event, 405);
  return { error: "method not allowed; POST JSON-RPC to this endpoint" };
});
