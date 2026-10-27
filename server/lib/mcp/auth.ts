// only the token's SHA256 is stored; every request re-checks the owner is still a supaadmin
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import db from "../../db";
import { mcpTokenTable, users } from "../../db/schema";
import { hasRole } from "../../policies/internal";
import { mlog, tail4 } from "./log";
import { getActiveMacondoBan } from "../macondo-ban";

export const MCP_TOKEN_PREFIX = "macondo_mcp_";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// the raw value is returned once; only its hash persists
export function generateMcpToken(): { raw: string; hash: string; last4: string } {
  const raw = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw), last4: raw.slice(-4) };
}

export interface McpContext {
  user: typeof users.$inferSelect;
  tokenId: string;
  tokenLabel: string;
  canWrite: boolean;
}

// null (caller -> 401) when unknown, revoked, expired, or the owner is no longer a supaadmin
export async function validateMcpToken(raw: string): Promise<McpContext | null> {
  if (!raw.startsWith(MCP_TOKEN_PREFIX)) {
    mlog("auth", "reject: wrong prefix", { bearer: tail4(raw) });
    return null;
  }

  const [row] = await db
    .select({
      id: mcpTokenTable.id,
      label: mcpTokenTable.label,
      can_write: mcpTokenTable.can_write,
      revoked_at: mcpTokenTable.revoked_at,
      expires_at: mcpTokenTable.expires_at,
      last_used_at: mcpTokenTable.last_used_at,
      user: users,
    })
    .from(mcpTokenTable)
    .innerJoin(users, eq(users.id, mcpTokenTable.user_id))
    .where(eq(mcpTokenTable.token_hash, sha256(raw)))
    .limit(1);

  if (!row) {
    mlog("auth", "reject: token not found", { bearer: tail4(raw) });
    return null;
  }
  if (row.revoked_at) {
    mlog("auth", "reject: revoked", { token: row.label, bearer: tail4(raw) });
    return null;
  }
  if (row.expires_at && row.expires_at.getTime() < Date.now()) {
    mlog("auth", "reject: expired", {
      token: row.label,
      expiredAt: row.expires_at.toISOString(),
    });
    return null;
  }
  if (!hasRole(row.user, ["supaadmin"])) {
    mlog("auth", "reject: owner not supaadmin", { user: row.user.email });
    return null;
  }
  mlog("auth", "ok", {
    user: row.user.email,
    token: row.label,
    canWrite: row.can_write,
  });

  if (await getActiveMacondoBan(row.user.id)) return null;

  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) { // only bump last_used_at once a minute
    db.update(mcpTokenTable)
      .set({ last_used_at: new Date() })
      .where(eq(mcpTokenTable.id, row.id))
      .catch(() => {});
  }

  return {
    user: row.user,
    tokenId: row.id,
    tokenLabel: row.label,
    canWrite: row.can_write,
  };
}
