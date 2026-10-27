import { eq } from "drizzle-orm";

import db from "../../../db";
import { faqEntryTable } from "../../../db/schema";
import { canManageInternalFAQ } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [deleted] = await db
    .delete(faqEntryTable)
    .where(eq(faqEntryTable.id, id))
    .returning();

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  return { ok: true, deleted };
});
