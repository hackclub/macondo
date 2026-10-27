import { eq } from "drizzle-orm";

import db from "../../../../db";
import { shopItemRequestTable } from "../../../../db/schema";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const reason = (await readBody<{ reason?: string }>(event))?.reason?.trim();
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: "Dismiss reason is required" });
  }

  await db
    .update(shopItemRequestTable)
    .set({
      dismissed_at: new Date(),
      dismissed_by: actor.id,
      dismissed_reason: reason.slice(0, 1000), // cap stored reason length
    })
    .where(eq(shopItemRequestTable.id, id));

  return { ok: true };
});
