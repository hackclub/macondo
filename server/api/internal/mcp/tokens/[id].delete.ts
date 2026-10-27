import { eq } from "drizzle-orm";

import db from "../../../../db";
import { mcpTokenTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { canManageMcpTokens } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canManageMcpTokens(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "No token id." });
  }

  const [deleted] = await db
    .delete(mcpTokenTable)
    .where(eq(mcpTokenTable.id, id))
    .returning({ id: mcpTokenTable.id, label: mcpTokenTable.label });

  if (deleted) {
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "mcp_token.delete",
        entity_type: "mcp_token",
        entity_id: id,
        old_value: { label: deleted.label },
        new_value: null,
        sensitive: true,
        public_message: `Deleted MCP token "${deleted.label}"`,
      });
    } catch (err) {
      console.error("[mcp] audit token delete failed", err);
    }
  }

  return { ok: true };
});
