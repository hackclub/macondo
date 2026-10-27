import { asc, eq, inArray } from "drizzle-orm";

import db from "../../../db";
import { kbEntryTable, kbSourceTable } from "../../../db/schema";
import { canManageSupporterKB } from "../../../policies/internal";

const VALID_STATUS = ["draft", "published", "archived"] as const;
type Status = (typeof VALID_STATUS)[number];

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const statusParam = typeof query.status === "string" ? query.status : null;
  if (statusParam && !(VALID_STATUS as readonly string[]).includes(statusParam)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid status" });
  }
  const status = statusParam ? (statusParam as Status) : null;

  // Leaves out the large embedding vector.
  const cols = {
    id: kbEntryTable.id,
    title: kbEntryTable.title,
    body_en: kbEntryTable.body_en,
    body_es: kbEntryTable.body_es,
    type: kbEntryTable.type,
    category: kbEntryTable.category,
    status: kbEntryTable.status,
    tags: kbEntryTable.tags,
    sort_order: kbEntryTable.sort_order,
    valid_from: kbEntryTable.valid_from,
    valid_until: kbEntryTable.valid_until,
    last_verified_at: kbEntryTable.last_verified_at,
    created_at: kbEntryTable.created_at,
    updated_at: kbEntryTable.updated_at,
  };

  const entries = status
    ? await db
        .select(cols)
        .from(kbEntryTable)
        .where(eq(kbEntryTable.status, status))
        .orderBy(asc(kbEntryTable.sort_order), asc(kbEntryTable.id))
    : await db
        .select(cols)
        .from(kbEntryTable)
        .orderBy(asc(kbEntryTable.sort_order), asc(kbEntryTable.id));

  const ids = entries.map((e) => e.id);
  const sources = ids.length
    ? await db
        .select({
          kb_entry_id: kbSourceTable.kb_entry_id,
          source_type: kbSourceTable.source_type,
          source_ref: kbSourceTable.source_ref,
          citation_text: kbSourceTable.citation_text,
        })
        .from(kbSourceTable)
        .where(inArray(kbSourceTable.kb_entry_id, ids))
    : [];

  const sourcesByEntry = new Map<number, typeof sources>();
  for (const s of sources) {
    const list = sourcesByEntry.get(s.kb_entry_id) ?? [];
    list.push(s);
    sourcesByEntry.set(s.kb_entry_id, list);
  }

  return {
    entries: entries.map((e) => ({
      ...e,
      sources: sourcesByEntry.get(e.id) ?? [],
    })),
  };
});
