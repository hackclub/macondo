import { eq } from "drizzle-orm";

import db from "../../../db";
import { kbEntryTable } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { canManageSupporterKB } from "../../../policies/internal";

// Prefer archiving over deleting to keep provenance; kb_sources rows cascade.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [deleted] = await db
    .delete(kbEntryTable)
    .where(eq(kbEntryTable.id, id))
    .returning({ id: kbEntryTable.id, title: kbEntryTable.title });

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "kb_entry.deleted",
    entity_type: "kb_entry",
    entity_id: String(id),
    new_value: { title: deleted.title },
  });

  return { ok: true, deleted };
});
