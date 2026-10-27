import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { npsResponseTable } from "../../../../../db/schema";
import { canAccessInternalStats } from "../../../../../policies/internal";

type ResolveBody = { resolved?: boolean };

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid submission id" });
  }

  const body = await readBody<ResolveBody>(event);
  if (typeof body?.resolved !== "boolean") {
    throw createError({
      statusCode: 400,
      statusMessage: "resolved must be a boolean",
    });
  }

  const [updated] = await db
    .update(npsResponseTable)
    .set(
      body.resolved
        ? { resolved_at: new Date(), resolved_by_user_id: actor.id }
        : { resolved_at: null, resolved_by_user_id: null },
    )
    .where(eq(npsResponseTable.id, id))
    .returning({
      id: npsResponseTable.id,
      resolved_at: npsResponseTable.resolved_at,
      resolved_by_user_id: npsResponseTable.resolved_by_user_id,
    });

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Submission not found" });
  }

  return {
    id: updated.id,
    resolved_at: updated.resolved_at
      ? updated.resolved_at instanceof Date
        ? updated.resolved_at.toISOString()
        : String(updated.resolved_at)
      : null,
    resolved_by_user_id: updated.resolved_by_user_id,
  };
});
