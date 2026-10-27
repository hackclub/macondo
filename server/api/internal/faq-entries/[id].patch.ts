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

  const body = await readBody<{
    question_en?: string;
    answer_en?: string;
    question_es?: string | null;
    answer_es?: string | null;
    sort_order?: number;
  }>(event);

  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (typeof body.question_en === "string") {
    const v = body.question_en.trim();
    if (!v) {
      throw createError({ statusCode: 400, statusMessage: "question_en cannot be empty" });
    }
    updates.question_en = v;
  }
  if (typeof body.answer_en === "string") {
    const v = body.answer_en.trim();
    if (!v) {
      throw createError({ statusCode: 400, statusMessage: "answer_en cannot be empty" });
    }
    updates.answer_en = v;
  }
  if (body.question_es !== undefined) {
    updates.question_es = body.question_es ? String(body.question_es).trim() || null : null;
  }
  if (body.answer_es !== undefined) {
    updates.answer_es = body.answer_es ? String(body.answer_es).trim() || null : null;
  }
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    updates.sort_order = Math.trunc(body.sort_order);
  }

  const [updated] = await db
    .update(faqEntryTable)
    .set(updates)
    .where(eq(faqEntryTable.id, id))
    .returning();

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  return { entry: updated };
});
