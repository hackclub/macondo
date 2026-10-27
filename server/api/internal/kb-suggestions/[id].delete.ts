import { eq } from "drizzle-orm";

import db from "../../../db";
import { kbSuggestionTable } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { canManageSupporterKB } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [deleted] = await db
    .delete(kbSuggestionTable)
    .where(eq(kbSuggestionTable.id, id))
    .returning();

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestion.deleted",
    entity_type: "kb_suggestion",
    entity_id: String(id),
  });

  return { ok: true, deleted };
});
