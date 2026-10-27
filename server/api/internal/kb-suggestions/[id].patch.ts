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

  // Accepted suggestions are frozen: editing them would desync the published kb_entries row.
  const [existing] = await db
    .select({
      status: kbSuggestionTable.status,
      question_en: kbSuggestionTable.question_en,
      answer_en: kbSuggestionTable.answer_en,
    })
    .from(kbSuggestionTable)
    .where(eq(kbSuggestionTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  if (existing.status !== "pending") {
    throw createError({
      statusCode: 409,
      statusMessage: "Only pending suggestions can be edited",
    });
  }

  const body = await readBody<{
    question_en?: string;
    answer_en?: string;
    question_es?: string | null;
    answer_es?: string | null;
    category?: string;
  }>(event);

  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.question_en === "string") {
    const v = body.question_en.trim();
    if (!v) {
      throw createError({
        statusCode: 400,
        statusMessage: "question_en cannot be empty",
      });
    }
    updates.question_en = v;
  }
  if (typeof body.answer_en === "string") {
    const v = body.answer_en.trim();
    if (!v) {
      throw createError({
        statusCode: 400,
        statusMessage: "answer_en cannot be empty",
      });
    }
    updates.answer_en = v;
  }
  if (body.question_es !== undefined) {
    updates.question_es = body.question_es
      ? String(body.question_es).trim() || null
      : null;
  }
  if (body.answer_es !== undefined) {
    updates.answer_es = body.answer_es
      ? String(body.answer_es).trim() || null
      : null;
  }
  if (typeof body.category === "string" && body.category.trim()) {
    updates.category = body.category.trim();
  }

  const [updated] = await db
    .update(kbSuggestionTable)
    .set(updates)
    .where(eq(kbSuggestionTable.id, id))
    .returning();

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestion.updated",
    entity_type: "kb_suggestion",
    entity_id: String(id),
    old_value: {
      question_en: existing.question_en,
      answer_en: existing.answer_en,
    },
    new_value: { fields: Object.keys(updates) },
  });

  return { suggestion: updated };
});
