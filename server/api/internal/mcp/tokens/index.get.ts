import { desc, eq } from "drizzle-orm";

import db from "../../../../db";
import { mcpTokenTable, users } from "../../../../db/schema";
import { canManageMcpTokens } from "../../../../policies/internal";

// Never return the raw token or its hash.
function tokenState(t: { revoked_at: Date | null; expires_at: Date | null }): string {
  if (t.revoked_at) return "revoked";
  if (t.expires_at && t.expires_at.getTime() < Date.now()) return "expired";
  return "active";
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canManageMcpTokens(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const rows = await db
    .select({
      id: mcpTokenTable.id,
      label: mcpTokenTable.label,
      last4: mcpTokenTable.last4,
      can_write: mcpTokenTable.can_write,
      created_at: mcpTokenTable.created_at,
      last_used_at: mcpTokenTable.last_used_at,
      expires_at: mcpTokenTable.expires_at,
      revoked_at: mcpTokenTable.revoked_at,
      owner_name: users.name,
      owner_email: users.email,
      owner_image: users.image,
    })
    .from(mcpTokenTable)
    .innerJoin(users, eq(users.id, mcpTokenTable.user_id))
    .orderBy(desc(mcpTokenTable.created_at));

  return {
    endpoint: "/api/mcp",
    tokens: rows.map((t) => ({
      id: t.id,
      label: t.label,
      last4: t.last4,
      can_write: t.can_write,
      owner_name: t.owner_name,
      owner_email: t.owner_email,
      owner_image: t.owner_image,
      state: tokenState(t),
      created_at: t.created_at,
      last_used_at: t.last_used_at,
      expires_at: t.expires_at,
    })),
  };
});
