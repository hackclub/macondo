import { desc, eq } from "drizzle-orm";

import db from "../../../db";
import { faqSuggestionTable, users } from "../../../db/schema";
import { canManageInternalFAQ } from "../../../policies/internal";

const VALID_STATUS = ["pending", "accepted", "rejected"] as const;
type Status = (typeof VALID_STATUS)[number];

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const statusParam = typeof query.status === "string" ? query.status : null;
  const status =
    statusParam && (VALID_STATUS as readonly string[]).includes(statusParam)
      ? (statusParam as Status)
      : null;

  const base = db
    .select({
      id: faqSuggestionTable.id,
      question_en: faqSuggestionTable.question_en,
      answer_en: faqSuggestionTable.answer_en,
      question_es: faqSuggestionTable.question_es,
      answer_es: faqSuggestionTable.answer_es,
      status: faqSuggestionTable.status,
      source_ticket_count: faqSuggestionTable.source_ticket_count,
      source_ticket_ids: faqSuggestionTable.source_ticket_ids,
      reviewed_at: faqSuggestionTable.reviewed_at,
      published_faq_id: faqSuggestionTable.published_faq_id,
      created_at: faqSuggestionTable.created_at,
      updated_at: faqSuggestionTable.updated_at,
      reviewer: {
        id: users.id,
        name: users.name,
        username: users.username,
        image: users.image,
      },
    })
    .from(faqSuggestionTable)
    .leftJoin(users, eq(faqSuggestionTable.reviewed_by_user_id, users.id));

  return {
    suggestions: status
      ? await base
          .where(eq(faqSuggestionTable.status, status))
          .orderBy(desc(faqSuggestionTable.created_at))
      : await base.orderBy(desc(faqSuggestionTable.created_at)),
  };
});
