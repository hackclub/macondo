import { asc } from "drizzle-orm";

import db from "../../../db";
import { faqEntryTable } from "../../../db/schema";
import { canManageInternalFAQ } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return {
    entries: await db
      .select()
      .from(faqEntryTable)
      .orderBy(asc(faqEntryTable.sort_order), asc(faqEntryTable.id)),
  };
});
