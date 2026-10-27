import { destroySession } from "../../../../lib/session";
import { writeAudit } from "../../../../lib/audit";
import { nukeUser } from "../../../../lib/user-nuke";
import { canNukeUser } from "../../../../../server/policies/internal";

type NukeBody = {
  reason?: string;
  confirm?: string;
};

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canNukeUser(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "Invalid user ID" });
  }

  const body = await readBody<NukeBody>(event).catch(() => ({}));
  // Enforced server-side so a drive-by POST can't nuke.
  if (body?.confirm !== "NUKE") {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirmation required: body must include {"confirm":"NUKE"}',
    });
  }

  try {
    const { backupId, selfNuke } = await nukeUser(
      id,
      { id: actor.id, name: actor.name ?? null },
      (body?.reason ?? "").trim() || null,
    );

    // Audit after the nuke commits so the row reflects final state.
    if (!selfNuke) {
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "nuke_user",
          entity_type: "user",
          entity_id: id,
          old_value: null,
          new_value: { backup_id: backupId, reason: body?.reason ?? null },
          sensitive: true,
          public_message: `User ${id} nuked by ${actor.name ?? actor.id}`,
        });
      } catch (err) {
        console.error("Failed to write audit for nuke_user", err);
      }
    }

    if (selfNuke) {
      // destroySession clears the real "macondo_session" cookie, otherwise the
      // nuker stays logged in as a vanished user.
      try {
        await destroySession(event);
      } catch (err) {
        console.error("[nuke] destroySession after self-nuke failed", err);
      }
    }

    return { success: true, backupId, selfNuke };
  } catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: `Nuke failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});
