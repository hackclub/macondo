import { desc, eq } from "drizzle-orm";

import db from "../../../../db";
import { faqEntryTable, faqSuggestionTable } from "../../../../db/schema";
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

  const body = await readBody<{
    question_en?: string;
    answer_en?: string;
    question_es?: string | null;
    answer_es?: string | null;
  }>(event).catch(() => ({}) as Record<string, never>);

  const result = await db.transaction(async (tx) => {
    const [suggestion] = await tx
      .select()
      .from(faqSuggestionTable)
      .where(eq(faqSuggestionTable.id, id));

    if (!suggestion) {
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    }

    if (suggestion.status === "accepted") {
      throw createError({
        statusCode: 409,
        statusMessage: "Suggestion already accepted",
      });
    }

    const finalQuestionEn =
      typeof body.question_en === "string" && body.question_en.trim()
        ? body.question_en.trim()
        : suggestion.question_en;
    const finalAnswerEn =
      typeof body.answer_en === "string" && body.answer_en.trim()
        ? body.answer_en.trim()
        : suggestion.answer_en;
    const finalQuestionEs =
      body.question_es !== undefined
        ? (body.question_es ? String(body.question_es).trim() || null : null)
        : suggestion.question_es;
    const finalAnswerEs =
      body.answer_es !== undefined
        ? (body.answer_es ? String(body.answer_es).trim() || null : null)
        : suggestion.answer_es;

    const [lastEntry] = await tx
      .select({ sort_order: faqEntryTable.sort_order })
      .from(faqEntryTable)
      .orderBy(desc(faqEntryTable.sort_order))
      .limit(1);

    const [entry] = await tx
      .insert(faqEntryTable)
      .values({
        question_en: finalQuestionEn,
        answer_en: finalAnswerEn,
        question_es: finalQuestionEs,
        answer_es: finalAnswerEs,
        source: "ai_generated",
        sort_order: (lastEntry?.sort_order ?? 0) + 10, // gap leaves room to reorder
      })
      .returning();

    if (!entry) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to create FAQ entry",
      });
    }

    const [updated] = await tx
      .update(faqSuggestionTable)
      .set({
        status: "accepted",
        question_en: finalQuestionEn,
        answer_en: finalAnswerEn,
        question_es: finalQuestionEs,
        answer_es: finalAnswerEs,
        reviewed_by_user_id: actor.id,
        reviewed_at: new Date(),
        published_faq_id: entry.id,
        updated_at: new Date(),
      })
      .where(eq(faqSuggestionTable.id, id))
      .returning();

    return { suggestion: updated, entry };
  });

  return { ok: true, ...result };
});
