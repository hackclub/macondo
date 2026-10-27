// Soft-deletes to keep audit history. Once anyone else has voted, only an admin can dismiss it.

import { and, eq, ne, sql } from "drizzle-orm";

import db from "../../../db";
import { shopItemRequestTable, shopItemRequestVoteTable } from "../../../db/schema";
import { getSession } from "../../../lib/session";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const requestId = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(requestId) || requestId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request id" });
  }

  const [request] = await db
    .select({
      id: shopItemRequestTable.id,
      user_id: shopItemRequestTable.user_id,
      upvote_count: shopItemRequestTable.upvote_count,
      dismissed_at: shopItemRequestTable.dismissed_at,
      promoted_to_item_id: shopItemRequestTable.promoted_to_item_id,
    })
    .from(shopItemRequestTable)
    .where(eq(shopItemRequestTable.id, requestId))
    .limit(1);

  if (!request) {
    throw createError({ statusCode: 404, statusMessage: "Suggestion not found" });
  }
  if (request.dismissed_at !== null) {
    throw createError({ statusCode: 404, statusMessage: "Suggestion not found" });
  }
  if (request.promoted_to_item_id !== null) {
    throw createError({
      statusCode: 409,
      statusMessage: "This suggestion was already promoted to a shop item and cannot be withdrawn.",
    });
  }

  const isAdmin = canAccessInternalShopAdmin(user);

  if (!isAdmin && request.user_id !== user.id) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  if (!isAdmin) {
    // Vote rows are exact where the denormalized upvote_count isn't.
    const [otherVotesRow] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(shopItemRequestVoteTable)
      .where(
        and(
          eq(shopItemRequestVoteTable.request_id, requestId),
          ne(shopItemRequestVoteTable.user_id, request.user_id),
        ),
      );

    if (Number(otherVotesRow?.n ?? 0) > 0) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Other people have voted on this suggestion. An admin will review it.",
      });
    }
  }

  await db
    .update(shopItemRequestTable)
    .set({
      dismissed_at: new Date(),
      dismissed_by: user.id,
    })
    .where(eq(shopItemRequestTable.id, requestId));

  return { ok: true };
});