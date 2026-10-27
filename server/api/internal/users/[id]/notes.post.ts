import db from "../../../../db";
import { internalNotesTable, users } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../../../../lib/audit";
import { canManageInternalNotes } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canManageInternalNotes(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const note = (await readBody<{ note: string }>(event)).note?.trim();

  if (!note) {
    throw createError({ statusCode: 400, statusMessage: "Note required" });
  }

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const [created] = await db
    .insert(internalNotesTable)
    .values({
      user_id: id,
      note,
      created_by: actor.id,
    })
    .returning();

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "create_internal_note",
      entity_type: "user",
      entity_id: id,
      old_value: null,
      new_value: { internal_note_id: created?.id ?? null, note },
      sensitive: true,
      public_message: null,
      change_summary: "Added an internal note",
    });
  } catch (error) {
    console.error("Failed to write audit log for internal note creation", error);
  }

  return { ok: true, note: created };
});
