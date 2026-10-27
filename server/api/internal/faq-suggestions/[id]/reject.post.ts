import { eq } from "drizzle-orm";

import db from "../../../../db";
import { faqSuggestionTable } from "../../../../db/schema";
import { canManageInternalFAQ } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [updated] = await db
    .update(faqSuggestionTable)
    .set({
      status: "rejected",
      reviewed_by_user_id: actor.id,
      reviewed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(faqSuggestionTable.id, id))
    .returning();

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  return { ok: true, suggestion: updated };
});
