import { adjustUserGold } from "../../../../lib/gold-adjust";
import { canAdjustUserGold } from "../../../../policies/internal";

// Logic lives in adjustUserGold so the MCP adjust_user_gold tool stays in lockstep.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAdjustUserGold(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const body = await readBody<{
    amount?: number;
    direction?: "add" | "subtract";
    note?: string;
    // Swaps in celebratory notification copy; only valid when adding gold.
    reason?: "show_and_tell_won" | "show_and_tell_participated";
  }>(event);

  const result = await adjustUserGold({
    targetUserId: id,
    amount: body.amount as number,
    direction: body.direction as "add" | "subtract",
    note: body.note ?? "",
    actorId: actor.id,
    reason: body.reason,
    via: "internal",
  });

  return { ok: true, transactionId: result.transactionId };
});
