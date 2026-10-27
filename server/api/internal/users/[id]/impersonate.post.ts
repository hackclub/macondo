import { eq } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { isHackatimeBanned } from "~~/server/lib/hackatime";
import { clearInternalReauthCookie } from "~~/server/lib/internal-reauth";
import { beginImpersonation } from "~~/server/lib/session";
import { canImpersonateUser } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "Missing user id" });
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  if (!canImpersonateUser(actor, target)) {
    throw createError({
      statusCode: 403,
      statusMessage: "You do not have permission to impersonate this user",
    });
  }

  const config = useRuntimeConfig();
  const banned = await isHackatimeBanned({
    adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
    hackatimeId: target.hackatime_id ?? null,
    hackatimeOAuthToken: target.hackatime_oauth_token ?? null,
    email: target.email ?? null,
    userId: target.id,
  });

  if (banned) {
    throw createError({
      statusCode: 403,
      statusMessage: "This user is banned and cannot be impersonated",
    });
  }

  await writeAudit({
    actor_id: actor.id,
    action: "impersonate_user",
    entity_type: "user",
    entity_id: target.id,
    old_value: null,
    new_value: {
      actor: {
        id: actor.id,
        roles: actor.roles ?? [],
      },
      target: {
        id: target.id,
        roles: target.roles ?? [],
      },
    },
    sensitive: true,
    public_message: null,
    change_summary: `Started impersonating ${target.name}`,
  });

  await beginImpersonation(event, target.id);
  clearInternalReauthCookie(event);

  return {
    ok: true,
    redirectTo: "/dashboard",
  };
});
