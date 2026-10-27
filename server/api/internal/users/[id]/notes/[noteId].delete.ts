import db from "../../../../../db";
import { internalNotesTable } from "../../../../../db/schema";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "../../../../../lib/audit";
import { canManageInternalNotes } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canManageInternalNotes(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const noteId = Number(getRouterParam(event, "noteId"));

  if (!Number.isInteger(noteId) || noteId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid note ID" });
  }

  const [existing] = await db
    .select()
    .from(internalNotesTable)
    .where(
      and(
        eq(internalNotesTable.id, noteId),
        eq(internalNotesTable.user_id, id),
      ),
    )
    .limit(1);

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Note not found" });
  }

  await db
    .delete(internalNotesTable)
    .where(
      and(
        eq(internalNotesTable.id, noteId),
        eq(internalNotesTable.user_id, id),
      ),
    );

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "delete_internal_note",
      entity_type: "user",
      entity_id: id,
      old_value: {
        internal_note_id: existing.id,
        note: existing.note,
        created_by: existing.created_by,
      },
      new_value: null,
      sensitive: true,
      public_message: null,
      change_summary: "Removed an internal note",
    });
  } catch (error) {
    console.error("Failed to write audit log for internal note deletion", error);
  }

  return { ok: true };
});
