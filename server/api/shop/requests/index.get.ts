// Public, no session required. Submitter username/image are exposed only when
// they opted in via show_username; email, slack_id and user_id never leak.

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import db from "../../../db";
import { shopItemRequestTable, shopItemRequestVoteTable, users } from "../../../db/schema";
import { ensureHistoricalShopRequestKeywordMaintenance } from "../../../lib/shop-request-tag";
import { getSession } from "../../../lib/session";

interface ListRow {
  id: number;
  name: string;
  description: string | null;
  store_url: string | null;
  image_url: string | null;
  cluster_id: number | null;
  group_tag: string | null;
  upvote_count: number;
  downvote_count: number;
  show_username: boolean;
  created_at: string | null;
  submitter: { username: string | null; image: string | null } | null;
  vote: "up" | "down" | null;
  voted: boolean;
  downvoted: boolean;
  can_delete: boolean;
}

export default defineCachedEventHandler(
  async (event) => {
    void ensureHistoricalShopRequestKeywordMaintenance({ dismissExistingItems: false });

    const query = getQuery(event);
    const searchQuery = ((query.q as string) ?? "").trim();

    // Clamped hard: crawlers walk page into the millions, and each page is a giant OFFSET and a cache key.
    const page = Math.min(1000, Math.max(1, parseInt((query.page as string) ?? "1") || 1));
    const limit = Math.min(50, Math.max(1, parseInt((query.limit as string) ?? "50") || 50));

    const user = await getSession(event);

    const filters = [
      isNull(shopItemRequestTable.dismissed_at),
      isNull(shopItemRequestTable.promoted_to_item_id),
    ];
    if (searchQuery) {
      const pattern = `%${searchQuery}%`;
      filters.push(
        or(
          ilike(shopItemRequestTable.name, pattern),
          ilike(shopItemRequestTable.description, pattern),
          ilike(shopItemRequestTable.group_tag, pattern),
        ),
      );
    }

    const items: ListRow[] = (
      await db
        .select({
          id: shopItemRequestTable.id,
          name: shopItemRequestTable.name,
          description: shopItemRequestTable.description,
          store_url: shopItemRequestTable.store_url,
          image_url: shopItemRequestTable.image_url,
          cluster_id: shopItemRequestTable.cluster_id,
          group_tag: shopItemRequestTable.group_tag,
          upvote_count: shopItemRequestTable.upvote_count,
          downvote_count: shopItemRequestTable.downvote_count,
          show_username: shopItemRequestTable.show_username,
          created_at: shopItemRequestTable.created_at,
          user_id: shopItemRequestTable.user_id,
          submitter_username: users.username,
          submitter_image: users.image,
          my_vote_id: user
            ? sql<number>`${shopItemRequestVoteTable.id}`.as("my_vote_id")
            : sql<number>`NULL::int`.as("my_vote_id"),
          my_vote_direction: user
            ? sql<string>`${shopItemRequestVoteTable.direction}`.as("my_vote_direction")
            : sql<string>`NULL::text`.as("my_vote_direction"),
        })
        .from(shopItemRequestTable)
        .leftJoin(users, eq(shopItemRequestTable.user_id, users.id))
        .leftJoin(
          shopItemRequestVoteTable,
          and(
            eq(shopItemRequestVoteTable.request_id, shopItemRequestTable.id),
            user ? eq(shopItemRequestVoteTable.user_id, user.id) : sql`FALSE`,
          ),
        )
        .where(and(...filters))
        .orderBy(
          query.sort === "new"
            ? desc(shopItemRequestTable.created_at)
            : desc(shopItemRequestTable.upvote_count),
          desc(shopItemRequestTable.created_at),
        )
        .limit(limit)
        .offset((page - 1) * limit)
    ).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      store_url: r.store_url,
      image_url: r.image_url,
      cluster_id: r.cluster_id,
      group_tag: r.group_tag,
      upvote_count: r.upvote_count,
      downvote_count: r.downvote_count,
      show_username: Boolean(r.show_username),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      submitter:
        r.show_username
          ? { username: r.submitter_username ?? null, image: r.submitter_image ?? null }
          : null,
      vote: r.my_vote_id ? (r.my_vote_direction === "down" ? "down" : "up") : null,
      voted: Boolean(r.my_vote_id && r.my_vote_direction !== "down"),
      downvoted: Boolean(r.my_vote_id && r.my_vote_direction === "down"),
      can_delete: Boolean(user && r.user_id === user.id && r.upvote_count === 0 && r.downvote_count === 0),
    }));

    const [totalRow] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(shopItemRequestTable)
      .where(and(...filters));

    return {
      items,
      total: Number(totalRow?.n ?? 0),
      page,
      limit,
      viewer_signed_in: Boolean(user),
      viewer_verified: user?.hca_verification_status === "verified",
    };
  },
  {
    name: "shop-requests-list",
    maxAge: 5, // 5s cache
    swr: true,
    // The cached handler sees a clone with only `varies` headers; without "cookie"
    // getSession() returns null. Sessions also bypass the cache below.
    varies: ["cookie"],
    // API-key requests carry no cookie, so bypass them too.
    shouldBypassCache: (event) =>
      !!getCookie(event, "macondo_session") || !!event.context.apiKeyAuth,
    // Only anonymous responses are cached, so the key covers public axes only.
    getKey: (event) => {
      const q = getQuery(event);
      const sort = q.sort === "new" ? "new" : "top";
      // Mirror the handler's clamps, or out-of-range values mint unbounded cache keys.
      const page = Math.min(1000, Math.max(1, parseInt((q.page as string) ?? "1") || 1));
      const limit = Math.min(50, Math.max(1, parseInt((q.limit as string) ?? "50") || 50));
      const searchQ = ((q.q as string) ?? "").trim();
      return `shop-requests|${sort}|${page}|${limit}|${searchQ}`;
    },
  },
);
