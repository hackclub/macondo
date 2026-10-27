import { and, desc, eq, ne } from "drizzle-orm";

import db from "../../../../db";
import {
  kbEntryTable,
  kbSourceTable,
  kbSuggestionTable,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { aiEmbed } from "../../../../lib/hackclub-ai";
import { canManageSupporterKB } from "../../../../policies/internal";

// body_es is carried through as-is (retrieval falls back to EN); Retranslate first if Spanish is wanted.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const body = await readBody<{
    question_en?: string;
    answer_en?: string;
    answer_es?: string | null;
  }>(event).catch(() => ({}) as Record<string, never>);

  const [suggestion] = await db
    .select()
    .from(kbSuggestionTable)
    .where(eq(kbSuggestionTable.id, id));
  if (!suggestion) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  if (suggestion.status === "accepted") {
    throw createError({
      statusCode: 409,
      statusMessage: "Suggestion already accepted",
    });
  }

  const titleSource =
    typeof body.question_en === "string" && body.question_en.trim()
      ? body.question_en.trim()
      : suggestion.question_en;
  const bodyEn =
    typeof body.answer_en === "string" && body.answer_en.trim()
      ? body.answer_en.trim()
      : suggestion.answer_en;
  const bodyEs =
    body.answer_es !== undefined
      ? body.answer_es
        ? String(body.answer_es).trim() || null
        : null
      : suggestion.answer_es;

  const citations = Array.isArray(suggestion.citations)
    ? suggestion.citations
    : [];
  if (citations.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "A KB entry needs at least one source citation",
    });
  }

  const title = titleSource.slice(0, 200); // kb_entries.title is a short label but questions can be long

  // Embed outside the transaction so the AI call doesn't hold it open; a null result still publishes.
  const embedding = await aiEmbed(`${title} ${bodyEn}`.slice(0, 8000)); // keep embedding input within model limits

  const result = await db.transaction(async (tx) => {
    // The conditional update is the concurrency guard: only the accept that flips the row publishes.
    const [claimed] = await tx
      .update(kbSuggestionTable)
      .set({
        status: "accepted",
        answer_es: bodyEs,
        reviewed_by_user_id: actor.id,
        reviewed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(kbSuggestionTable.id, id),
          ne(kbSuggestionTable.status, "accepted"),
        ),
      )
      .returning({ id: kbSuggestionTable.id });
    if (!claimed) {
      throw createError({
        statusCode: 409,
        statusMessage: "Suggestion already accepted",
      });
    }

    const [lastEntry] = await tx
      .select({ sort_order: kbEntryTable.sort_order })
      .from(kbEntryTable)
      .orderBy(desc(kbEntryTable.sort_order))
      .limit(1);

    const [entry] = await tx
      .insert(kbEntryTable)
      .values({
        title,
        body_en: bodyEn,
        body_es: bodyEs,
        type: "guide",
        category: suggestion.category,
        status: "published",
        sort_order: (lastEntry?.sort_order ?? 0) + 10, // gap leaves room to reorder
        embedding: embedding ?? null,
        created_by_user_id: actor.id,
      })
      .returning({
        id: kbEntryTable.id,
        title: kbEntryTable.title,
        category: kbEntryTable.category,
        status: kbEntryTable.status,
      });
    if (!entry) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to create KB entry",
      });
    }

    await tx.insert(kbSourceTable).values(
      citations.map((c) => ({
        kb_entry_id: entry.id,
        source_type: "support_ticket" as const,
        source_ref: String(c.ticket_id),
        citation_text: c.snippet,
        added_by_user_id: actor.id,
      })),
    );

    const [updated] = await tx
      .update(kbSuggestionTable)
      .set({ published_kb_id: entry.id })
      .where(eq(kbSuggestionTable.id, id))
      .returning();

    return { suggestion: updated, entry };
  });

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestion.accepted",
    entity_type: "kb_entry",
    entity_id: String(result.entry.id),
    new_value: {
      suggestion_id: id,
      title: result.entry.title,
      category: result.entry.category,
      sources: citations.length,
      embedded: embedding != null,
    },
  });

  return { ok: true, suggestion: result.suggestion, entry: result.entry };
});
