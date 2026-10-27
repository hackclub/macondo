import { and, eq, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  notificationTable,
  shopItemRequestTable,
  shopItemRequestVoteTable,
  users,
} from "../../../../db/schema";
import { getSession } from "../../../../lib/session";
import { notify } from "../../../../lib/notify";
import { getDisplayName } from "../../../../lib/user";

type VoteDirection = "up" | "down";

// Low-vote suggestions need a stronger downvote consensus to auto-dismiss, while
// heavily-upvoted ones can retire without half the voters piling on.
function removalThreshold(upvotes: number) {
  if (upvotes <= 0) return 3;
  if (upvotes <= 10) return Math.max(5, Math.ceil(upvotes * 0.6));
  if (upvotes <= 25) return Math.ceil(upvotes * 0.5);
  if (upvotes <= 75) return Math.ceil(upvotes * 0.4);
  return Math.ceil(upvotes * 0.3);
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  // Verified humans only, like project upvotes, to stop sybil vote flooding.
  if (user.hca_verification_status !== "verified") {
    throw createError({
      statusCode: 403,
      statusMessage: "HCA verification required",
    });
  }

  const requestId = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(requestId) || requestId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request id" });
  }

  const body = await readBody<{ direction?: unknown }>(event).catch(() => ({}));
  const direction: VoteDirection = body.direction === "down" ? "down" : "up";

  // Possibly stale; counts are recomputed inside the transaction below.
  const [request] = await db
    .select({
      id: shopItemRequestTable.id,
      user_id: shopItemRequestTable.user_id,
      upvote_count: shopItemRequestTable.upvote_count,
      downvote_count: shopItemRequestTable.downvote_count,
      group_tag: shopItemRequestTable.group_tag,
      name: shopItemRequestTable.name,
      promoted_to_item_id: shopItemRequestTable.promoted_to_item_id,
      dismissed_by_self: shopItemRequestTable.dismissed_at,
    })
    .from(shopItemRequestTable)
    .where(eq(shopItemRequestTable.id, requestId))
    .limit(1);

  if (!request) {
    throw createError({ statusCode: 404, statusMessage: "Suggestion not found" });
  }
  if (request.dismissed_by_self !== null || request.promoted_to_item_id !== null) {
    throw createError({ statusCode: 404, statusMessage: "Suggestion not found" });
  }

  if (request.user_id === user.id) {
    return {
      vote: null,
      voted: false,
      downvoted: false,
      count: request.upvote_count,
      upvote_count: request.upvote_count,
      downvote_count: request.downvote_count,
      removed: false,
    };
  }

  const [existing] = await db
    .select({ id: shopItemRequestVoteTable.id, direction: shopItemRequestVoteTable.direction })
    .from(shopItemRequestVoteTable)
    .where(
      and(
        eq(shopItemRequestVoteTable.request_id, requestId),
        eq(shopItemRequestVoteTable.user_id, user.id),
      ),
    )
    .limit(1);

  const result = await db.transaction(async (tx) => {
    if (existing?.direction === direction) {
      await tx
        .delete(shopItemRequestVoteTable)
        .where(eq(shopItemRequestVoteTable.id, existing.id));
    } else if (existing) {
      await tx
        .update(shopItemRequestVoteTable)
        .set({ direction })
        .where(eq(shopItemRequestVoteTable.id, existing.id));
    } else {
      // onConflictDoNothing keeps a concurrent double-submit idempotent.
      await tx
        .insert(shopItemRequestVoteTable)
        .values({
          request_id: requestId,
          user_id: user.id,
          first_voted_at: new Date(),
          direction,
        })
        .onConflictDoNothing({
          target: [shopItemRequestVoteTable.request_id, shopItemRequestVoteTable.user_id],
        });
    }

    // The UPDATE row-locks the request, so concurrent voters can't drift the counts.
    await tx
      .update(shopItemRequestTable)
      .set({
        upvote_count: sql`(
          SELECT COUNT(*)::int FROM ${shopItemRequestVoteTable}
          WHERE ${shopItemRequestVoteTable.request_id} = ${requestId}
            AND ${shopItemRequestVoteTable.direction} = 'up'
        )`,
        downvote_count: sql`(
          SELECT COUNT(*)::int FROM ${shopItemRequestVoteTable}
          WHERE ${shopItemRequestVoteTable.request_id} = ${requestId}
            AND ${shopItemRequestVoteTable.direction} = 'down'
        )`,
      })
      .where(eq(shopItemRequestTable.id, requestId));

    const [fresh] = await tx
      .select({
        upvote_count: shopItemRequestTable.upvote_count,
        downvote_count: shopItemRequestTable.downvote_count,
        dismissed_at: shopItemRequestTable.dismissed_at,
      })
      .from(shopItemRequestTable)
      .where(eq(shopItemRequestTable.id, requestId))
      .limit(1);

    const [finalVote] = await tx
      .select({ direction: shopItemRequestVoteTable.direction })
      .from(shopItemRequestVoteTable)
      .where(
        and(
          eq(shopItemRequestVoteTable.request_id, requestId),
          eq(shopItemRequestVoteTable.user_id, user.id),
        ),
      )
      .limit(1);

    const upvotes = Number(fresh?.upvote_count ?? 0);
    const downvotes = Number(fresh?.downvote_count ?? 0);
    const removed = downvotes >= removalThreshold(upvotes);
    if (removed && !fresh?.dismissed_at) {
      await tx
        .update(shopItemRequestTable)
        .set({
          dismissed_at: new Date(),
          dismissed_reason: "Removed after community downvotes.",
        })
        .where(eq(shopItemRequestTable.id, requestId));
    }

    return {
      vote: finalVote?.direction ?? null,
      upvote_count: upvotes,
      downvote_count: downvotes,
      removed,
    };
  });

  // Once per (request, voter): vote rows are deleted on un-vote, so the notifications
  // table is the dedupe ledger that stops toggle spam.
  const dedupeEntityId = `${requestId}:${user.id}`;
  if (result.vote === "up" && existing?.direction !== "up") {
    try {
      const [submitter] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, request.user_id))
        .limit(1);
      if (submitter) {
        const [prior] = await db
          .select({ id: notificationTable.id })
          .from(notificationTable)
          .where(
            and(
              eq(notificationTable.user_id, submitter.id),
              eq(notificationTable.type, "shop_request_upvoted"),
              eq(notificationTable.entity_type, "shop_request_upvote"),
              eq(notificationTable.entity_id, dedupeEntityId),
            ),
          )
          .limit(1);
        if (!prior) {
          await notify({
            user_id: submitter.id,
            type: "shop_request_upvoted",
            title: "New upvote on your shop suggestion",
            body: `${getDisplayName(user)} wants your shop suggestion: ${request.name}`,
            action_url: `/shop-requests?focus=${requestId}`,
            // Composite dedupe key, not a bare request id.
            entity_type: "shop_request_upvote",
            entity_id: dedupeEntityId,
            slack: {
              text: `:star: ${getDisplayName(user)} wants your shop suggestion: ${request.name}`,
            },
          });
        }
      }
    } catch (err) {
      // Never break a vote over a notify failure.
      console.warn("[shop-requests.vote] notify failed", err);
    }
  }

  return {
    vote: result.vote,
    voted: result.vote === "up",
    downvoted: result.vote === "down",
    count: result.upvote_count,
    upvote_count: result.upvote_count,
    downvote_count: result.downvote_count,
    removed: result.removed,
  };
});
