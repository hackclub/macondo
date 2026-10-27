import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { mcpTokenTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { canManageMcpTokens } from "../../../../../policies/internal";

// Keep the row for audit; the token fails closed on its next request.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canManageMcpTokens(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "No token id." });
  }

  const [existing] = await db
    .select({ id: mcpTokenTable.id, label: mcpTokenTable.label, revoked_at: mcpTokenTable.revoked_at })
    .from(mcpTokenTable)
    .where(eq(mcpTokenTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "No such token." });
  }

  if (!existing.revoked_at) {
    await db
      .update(mcpTokenTable)
      .set({ revoked_at: new Date() })
      .where(eq(mcpTokenTable.id, id));
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "mcp_token.revoke",
        entity_type: "mcp_token",
        entity_id: id,
        old_value: { revoked: false },
        new_value: { revoked: true },
        sensitive: true,
        public_message: `Revoked MCP token "${existing.label}"`,
      });
    } catch (err) {
      console.error("[mcp] audit token revoke failed", err);
    }
  }

  return { ok: true };
});
