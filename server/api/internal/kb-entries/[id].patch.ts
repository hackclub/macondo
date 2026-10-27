import { eq } from "drizzle-orm";

import db from "../../../db";
import { kbEntryTable } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { aiEmbed } from "../../../lib/hackclub-ai";
import { canManageSupporterKB } from "../../../policies/internal";

const VALID_STATUS = ["draft", "published", "archived"] as const;

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
    title?: string;
    body_en?: string;
    body_es?: string | null;
    type?: string;
    category?: string;
    status?: string;
    sort_order?: number;
    tags?: string[];
  }>(event);

  const [current] = await db
    .select({ title: kbEntryTable.title, body_en: kbEntryTable.body_en })
    .from(kbEntryTable)
    .where(eq(kbEntryTable.id, id));
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  let nextTitle = current.title;
  let nextBodyEn = current.body_en;
  let needsReembed = false;

  if (typeof body.title === "string") {
    const v = body.title.trim().slice(0, 200); // same title cap as the accept handler
    if (!v) {
      throw createError({
        statusCode: 400,
        statusMessage: "title cannot be empty",
      });
    }
    updates.title = v;
    if (v !== current.title) {
      nextTitle = v;
      needsReembed = true;
    }
  }
  if (typeof body.body_en === "string") {
    const v = body.body_en.trim();
    if (!v) {
      throw createError({
        statusCode: 400,
        statusMessage: "body_en cannot be empty",
      });
    }
    updates.body_en = v;
    if (v !== current.body_en) {
      nextBodyEn = v;
      needsReembed = true;
    }
  }
  if (body.body_es !== undefined) {
    updates.body_es = body.body_es ? String(body.body_es).trim() || null : null;
  }
  if (typeof body.type === "string" && body.type.trim()) {
    updates.type = body.type.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    updates.category = body.category.trim();
  }
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !(VALID_STATUS as readonly string[]).includes(body.status)
    ) {
      throw createError({ statusCode: 400, statusMessage: "Invalid status" });
    }
    updates.status = body.status;
  }
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    updates.sort_order = Math.trunc(body.sort_order);
  }
  if (Array.isArray(body.tags)) {
    updates.tags = body.tags.filter((t) => typeof t === "string");
  }

  // A null embedding (AI down) keeps the old one rather than dropping the entry from retrieval.
  if (needsReembed) {
    const emb = await aiEmbed(`${nextTitle} ${nextBodyEn}`.slice(0, 8000)); // keep embedding input within model limits
    if (emb) updates.embedding = emb;
  }

  const [updated] = await db
    .update(kbEntryTable)
    .set(updates)
    .where(eq(kbEntryTable.id, id))
    .returning({
      id: kbEntryTable.id,
      title: kbEntryTable.title,
      body_en: kbEntryTable.body_en,
      body_es: kbEntryTable.body_es,
      type: kbEntryTable.type,
      category: kbEntryTable.category,
      status: kbEntryTable.status,
      tags: kbEntryTable.tags,
      sort_order: kbEntryTable.sort_order,
      updated_at: kbEntryTable.updated_at,
    });

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "kb_entry.updated",
    entity_type: "kb_entry",
    entity_id: String(id),
    new_value: { reembedded: needsReembed, fields: Object.keys(updates) },
  });

  return { entry: updated };
});
