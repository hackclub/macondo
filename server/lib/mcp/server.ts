// hand-rolled instead of @modelcontextprotocol/sdk, whose HTTP transport wants Node req/res, not h3
import { TOOLS, listToolSpecs } from "./tools";
import type { McpContext } from "./auth";
import { mlog } from "./log";

const SERVER_INFO = { name: "macondo", version: "0.0.1" };
const SUPPORTED_PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

type Id = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

// null for notifications (no id); the caller answers those with HTTP 202
export async function dispatch(
  req: JsonRpcRequest,
  ctx: McpContext,
): Promise<object | null> {
  const id = req.id ?? null;
  const method = req.method;
  mlog("rpc", `${method ?? "(none)"}`, { id });

  if (req.id === undefined || req.id === null) {
    if (method?.startsWith("notifications/")) {
      mlog("rpc", `notification ack: ${method}`);
      return null;
    }
  }

  switch (method) {
    case "initialize": {
      const requested = req.params?.protocolVersion;
      const negotiated =
        requested && SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18"; // default protocol version
      mlog("rpc", "initialize", { requested: requested ?? "(none)", negotiated });
      return ok(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Supaadmin-scoped access to Macondo, Hack Club's YSWS platform. Read tools cover users, projects, ships/reviews, streaks (get_user_streak, get_streak_calendar, list_streak_events, list_freeze_burns, freeze_inventory_distribution, and the read-only freeze-cohort detectors get_stranded_gapbridge_cohort / get_optout_freeze_burn_cohort / get_zerostreak_sideproject_freeze_cohort), shop orders, currency, support tickets, audit logs, FINES (list_fines / get_fine from the Unified Airtable; get_fine links a fine to its ship), and ship remediation preflight (get_ship_reward). preview_deflate_ship_hours and preview_cap_project_level COMPUTE proposed reward changes but never write (apply via the scripts). Write tools (read-write token) require a real supaadmin token: adjust_user_gold, set_user_roles, resolve_support_ticket; streak remediation (requalify_pending_streak_days, refund_streak_freeze, heal_streak_day); and ship status remediation (ship_reject, ship_revert_approval — the safe gold-clawback for a paid/fined ship). Fines workflow: list_fines/get_fine -> get_ship_reward -> ship_reject or ship_revert_approval.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const specs = listToolSpecs(ctx.canWrite);
      mlog("rpc", "tools/list", { count: specs.length, canWrite: ctx.canWrite });
      return ok(id, { tools: specs });
    }
    case "tools/call": {
      const name = req.params?.name;
      mlog("rpc", `tools/call: ${name ?? "(missing name)"}`);
      const tool = name ? TOOLS[name] : undefined;
      if (!tool) {
        return fail(id, -32602, `Unknown tool: ${name ?? "(missing name)"}`);
      }
      try {
        const result = await tool.handler(req.params?.arguments ?? {}, ctx);
        mlog("rpc", `tools/call ok: ${name}`);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        // reported as isError, not a protocol error, so the model sees the message
        mlog("rpc", `tools/call error: ${name}`, { error: (e as Error).message });
        return ok(id, {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      mlog("rpc", `method not found: ${method ?? "(none)"}`);
      return fail(id, -32601, `Method not found: ${method ?? "(none)"}`);
  }
}
