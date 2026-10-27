import { setUserRoles } from "../../../../lib/user-roles";

// Auth and audit live in setUserRoles so the MCP set_user_roles tool stays in lockstep.
export default defineEventHandler(async (event) => {
  await setUserRoles({
    actor: event.context.user,
    targetUserId: getRouterParam(event, "id")!,
    roles: (await readBody<{ roles: string[] }>(event)).roles,
    via: "internal",
  });

  return { ok: true };
});
