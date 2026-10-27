import { and, eq } from "drizzle-orm";

import db from "../../../../db";
import { kbSuggestionTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { canManageSupporterKB } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  // Pending-only: rejecting an accepted suggestion would strand its published kb_entries row.
  const [updated] = await db
    .update(kbSuggestionTable)
    .set({
      status: "rejected",
      reviewed_by_user_id: actor.id,
      reviewed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(kbSuggestionTable.id, id),
        eq(kbSuggestionTable.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    const [row] = await db
      .select({ status: kbSuggestionTable.status })
      .from(kbSuggestionTable)
      .where(eq(kbSuggestionTable.id, id))
      .limit(1);
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    }
    throw createError({
      statusCode: 409,
      statusMessage: "Only pending suggestions can be rejected",
    });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestion.rejected",
    entity_type: "kb_suggestion",
    entity_id: String(id),
  });

  return { ok: true, suggestion: updated };
});
