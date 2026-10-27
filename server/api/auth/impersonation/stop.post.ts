import { writeAudit } from "~~/server/lib/audit";
import {
  getImpersonatorSession,
  getSession,
  stopImpersonation,
} from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const currentUser = await getSession(event);
  const impersonator = await getImpersonatorSession(event);

  if (!impersonator) {
    throw createError({
      statusCode: 400,
      statusMessage: "No active impersonation session",
    });
  }

  const restoredUser = await stopImpersonation(event);

  await writeAudit({
    actor_id: restoredUser.id,
    action: "stop_impersonating_user",
    entity_type: "user",
    entity_id: currentUser?.id ?? restoredUser.id,
    old_value: null,
    new_value: {
      impersonator: {
        id: restoredUser.id,
        roles: restoredUser.roles ?? [],
      },
      target: currentUser
        ? {
            id: currentUser.id,
            roles: currentUser.roles ?? [],
          }
        : null,
    },
    sensitive: true,
    public_message: null,
    change_summary: currentUser
      ? `Stopped impersonating ${currentUser.name}`
      : "Stopped impersonating after the target session ended",
  });

  return {
    ok: true,
    redirectTo: "/internal/users",
    actor: {
      id: impersonator.id,
      name: impersonator.name,
    },
  };
});
