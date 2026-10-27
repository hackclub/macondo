import db from "../../../../db";

import { writeAudit } from "../../../../lib/audit";

import { shadowBanTable } from "../../../../db/schema";
import { isAbleToReview } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ reason: string }>(event);

  if (!body.reason?.trim()) {
    throw createError({ statusCode: 400, statusMessage: "Reason required" });
  }

  await db.insert(shadowBanTable).values({
    user_id: id,
    reason: body.reason.trim(),
    created_by_user_id: actor.id,
  });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "create_shadow_ban",
      entity_type: "user",
      entity_id: id,
      old_value: null,
      new_value: { reason: body.reason.trim(), created_by: actor.id },
      sensitive: true,
      public_message: null,
    });
  } catch (e) {
    console.error("Failed to write audit log for shadow ban", e);
  }

  return { ok: true };
});
