import { eq } from "drizzle-orm";

import db from "../../../../db";
import { shipTable } from "../../../../db/schema";
import { syncShipToAirtable } from "../../../../lib/airtable";
import { getDevDebugFlags } from "../../../../lib/dev-debug-flags";
import {
  canReviewOwnProjects,
  isAbleToReview,
} from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const devDebugFlags = getDevDebugFlags(event);

  if (!actor || !isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ship ID" });
  }

  const forceResync =
    (await readBody<{ force?: boolean } | null>(event).catch(() => null))?.force === true;

  const [ship] = await db
    .select({
      id: shipTable.id,
      status: shipTable.status,
      user_id: shipTable.user_id,
    })
    .from(shipTable)
    .where(eq(shipTable.id, id))
    .limit(1);

  if (!ship) {
    throw createError({ statusCode: 404, statusMessage: "Ship not found" });
  }

  if (
    ship.user_id === actor.id &&
    !canReviewOwnProjects(actor) &&
    !devDebugFlags.ignoreReviewerOwnershipPolicies
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "You cannot review your own project",
    });
  }

  if (!forceResync && ship.status !== "shipped_missing_airtable") {
    throw createError({
      statusCode: 409,
      statusMessage: "Ship is not awaiting Airtable sync",
    });
  }

  if (forceResync && ship.status !== "shipped_missing_airtable" && ship.status !== "shipped") {
    throw createError({
      statusCode: 409,
      statusMessage: `Ship status '${ship.status}' cannot be resynced to Airtable.`,
    });
  }

  await syncShipToAirtable(id, { force: forceResync, reviewerUserId: actor.id });

  const [updated] = await db
    .select({ id: shipTable.id, status: shipTable.status })
    .from(shipTable)
    .where(eq(shipTable.id, id))
    .limit(1);

  return {
    success: forceResync
      ? updated?.status === "shipped" || updated?.status === "shipped_missing_airtable"
      : updated?.status === "shipped",
    status: updated?.status ?? ship.status,
    forced: forceResync,
  };
});
