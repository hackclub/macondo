// clawback lives in server/lib/revert-ship.ts so the ARI inbound decision path can reuse it

import { revertShipApproval } from "../../../../lib/revert-ship";
import { canAccessInternalShippedProjects } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  if (!canAccessInternalShippedProjects(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ship ID" });
  }

  const body = await readBody<{
    internalNotes?: string | null;
    publicNotes?: string | null;
  }>(event);
  const internalNotes = body?.internalNotes?.trim() || null;

  if (!internalNotes) {
    throw createError({
      statusCode: 400,
      statusMessage: "Internal notes are required to revert an approved ship.",
    });
  }

  const result = await revertShipApproval({
    shipId: id,
    actorId: actor.id,
    internalNotes,
    publicNotes: body?.publicNotes?.trim() || null,
  });

  return {
    ok: true,
    ship: result.ship,
    cancelledGrantCount: result.cancelledGrantCount,
    cancelledSentGrantCount: result.cancelledSentGrantCount,
    disabledCurrencyTransactionCount: result.disabledCurrencyTransactionCount,
    restoredPendingCurrencyTransactionCount:
      result.restoredPendingCurrencyTransactionCount,
    clawBackDisabledCurrencyTransactionCount:
      result.clawBackDisabledCurrencyTransactionCount,
    clawBackCancelledShopOrderCount: result.clawBackCancelledShopOrderCount,
  };
});
