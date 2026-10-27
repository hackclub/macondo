// shared by the roles PATCH endpoint and the MCP set_user_roles tool so both enforce the same guards
import { eq } from "drizzle-orm";
import { createError } from "h3";

import db from "../db";
import { users } from "../db/schema";
import { writeAudit } from "./audit";
import { canAccess, hasRole } from "../policies/internal";

export const ASSIGNABLE_ROLES = [
  "supaadmin",
  "admin",
  "fraudster",
  "software_reviewer",
  "hardware_reviewer",
  "fulfiller",
  "hq",
  "support",
  "events",
] as const;

export interface SetUserRolesInput {
  actor: typeof users.$inferSelect;
  targetUserId: string;
  roles: string[];
  via?: string;
}

export async function setUserRoles(
  input: SetUserRolesInput,
): Promise<{ oldRoles: string[]; newRoles: string[] }> {
  const { actor, targetUserId, roles, via } = input;

  if (
    !canAccess(actor) ||
    !(actor.roles ?? []).some((r) => ["supaadmin", "admin"].includes(r))
  ) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  if (
    !Array.isArray(roles) ||
    roles.some((r) => !ASSIGNABLE_ROLES.includes(r as (typeof ASSIGNABLE_ROLES)[number]))
  ) {
    throw createError({ statusCode: 400, statusMessage: "Invalid roles" });
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  // otherwise an admin could promote themselves to supaadmin
  const oldRoles = existing.roles ?? [];
  const oldHasSupa = oldRoles.includes("supaadmin");
  const newHasSupa = roles.includes("supaadmin");
  if (!hasRole(actor, ["supaadmin"]) && (oldHasSupa || newHasSupa)) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only supaadmins may grant, revoke, or edit the supaadmin role",
    });
  }

  await db.update(users).set({ roles }).where(eq(users.id, targetUserId));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "update_user_roles",
      entity_type: "user",
      entity_id: targetUserId,
      old_value: { roles: oldRoles },
      new_value: { roles, ...(via ? { via } : {}) },
      sensitive: true,
      public_message: null,
    });
  } catch (e) {
    console.error("Failed to write audit log for role change", e);
  }

  return { oldRoles, newRoles: roles };
}
