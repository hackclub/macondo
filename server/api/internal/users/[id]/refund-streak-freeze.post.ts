import { refundStreakFreeze } from "../../../../lib/streak-freeze-refund";
import { isAbleToReview } from "../../../../policies/internal";

// Logic lives in refundStreakFreeze so the MCP refund_streak_freeze tool stays in lockstep.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ day?: string; reason?: string }>(event);

  return await refundStreakFreeze({
    userId: id,
    day: body?.day ?? "",
    reason: body?.reason ?? "",
    actorId: actor.id,
    via: "internal",
  });
});
