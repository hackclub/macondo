import { writeAudit } from "../../../../../lib/audit";
import { restoreUserFromBackup } from "../../../../../lib/user-nuke";
import { canNukeUser } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canNukeUser(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const backupId = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(backupId) || backupId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid backup ID" });
  }

  try {
    const { restoredUserId } = await restoreUserFromBackup(backupId, {
      id: actor.id,
      name: actor.name ?? null,
    });

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "restore_user",
        entity_type: "user",
        entity_id: restoredUserId,
        old_value: { backup_id: backupId },
        new_value: null,
        sensitive: true,
        public_message: `User ${restoredUserId} restored from backup ${backupId} by ${actor.name ?? actor.id}`,
      });
    } catch (err) {
      console.error("Failed to write audit for restore_user", err);
    }

    return { success: true, restoredUserId };
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : String(err),
    });
  }
});
