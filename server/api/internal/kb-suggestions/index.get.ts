import { desc, eq, sql } from "drizzle-orm";

import db from "../../../db";
import { kbSuggestionTable, users } from "../../../db/schema";
import { canManageSupporterKB } from "../../../policies/internal";

const VALID_STATUS = ["pending", "accepted", "rejected", "archived"] as const;
type Status = (typeof VALID_STATUS)[number];

// ?counts=1 returns per-status totals for the tab badges so the client needn't pull every list.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);

  if (query.counts === "1" || query.counts === "true") {
    const rows = await db
      .select({
        status: kbSuggestionTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(kbSuggestionTable)
      .groupBy(kbSuggestionTable.status);
    const counts = Object.fromEntries(
      VALID_STATUS.map((s) => [s, 0]),
    ) as Record<Status, number>;
    for (const row of rows) {
      if ((VALID_STATUS as readonly string[]).includes(row.status)) {
        counts[row.status as Status] = row.count;
      }
    }
    return { counts };
  }

  const statusParam = typeof query.status === "string" ? query.status : null;
  if (statusParam && !(VALID_STATUS as readonly string[]).includes(statusParam)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid status" });
  }
  const status = statusParam ? (statusParam as Status) : null;

  const base = db
    .select({
      id: kbSuggestionTable.id,
      question_en: kbSuggestionTable.question_en,
      answer_en: kbSuggestionTable.answer_en,
      question_es: kbSuggestionTable.question_es,
      answer_es: kbSuggestionTable.answer_es,
      status: kbSuggestionTable.status,
      category: kbSuggestionTable.category,
      source_ticket_count: kbSuggestionTable.source_ticket_count,
      source_ticket_ids: kbSuggestionTable.source_ticket_ids,
      citations: kbSuggestionTable.citations,
      reviewed_at: kbSuggestionTable.reviewed_at,
      published_kb_id: kbSuggestionTable.published_kb_id,
      created_at: kbSuggestionTable.created_at,
      updated_at: kbSuggestionTable.updated_at,
      reviewer: {
        id: users.id,
        name: users.name,
        username: users.username,
        image: users.image,
      },
    })
    .from(kbSuggestionTable)
    .leftJoin(users, eq(kbSuggestionTable.reviewed_by_user_id, users.id));

  return {
    suggestions: status
      ? await base
          .where(eq(kbSuggestionTable.status, status))
          .orderBy(desc(kbSuggestionTable.created_at))
      : await base.orderBy(desc(kbSuggestionTable.created_at)),
  };
});
