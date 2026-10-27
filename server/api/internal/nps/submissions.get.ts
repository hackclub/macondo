import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../../../db";
import {
  npsResponseRepliesTable,
  npsResponseTable,
  users,
} from "../../../db/schema";
import { canAccessInternalStats } from "../../../policies/internal";
import { getBannedUserIds } from "../../../lib/hackatime";

type ReplyRow = {
  id: number;
  body: string;
  created_at: string;
  is_inbound: boolean;
  slack_delivered: boolean;
  slack_error: string | null;
  responder: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
};

type SubmissionRow = {
  id: number;
  score: number;
  doing_well: string;
  can_improve: string;
  anything_else: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    slack_id: string | null;
    username: string | null;
  };
  replies: ReplyRow[];
};

export type NpsSubmissionsResponse = {
  items: SubmissionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    bucket: "all" | "promoters" | "passives" | "detractors";
    sort: "newest" | "needs-reply";
    from: string | null;
    to: string | null;
  };
};

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default defineEventHandler(async (event): Promise<NpsSubmissionsResponse> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const page = parseIntParam(query.page, 1, 1, 10_000);
  const pageSize = parseIntParam(query.pageSize ?? query.limit, 25, 1, 100);
  const rawBucket = typeof query.bucket === "string" ? query.bucket : "all";
  const bucket: NpsSubmissionsResponse["filters"]["bucket"] =
    rawBucket === "promoters" || rawBucket === "passives" || rawBucket === "detractors"
      ? rawBucket
      : "all";
  const rawSort = typeof query.sort === "string" ? query.sort : "newest";
  const sort: NpsSubmissionsResponse["filters"]["sort"] =
    rawSort === "needs-reply" ? "needs-reply" : "newest";
  const fromDate = parseDate(query.from);
  const toDate = parseDate(query.to);

  const whereClauses = [];
  if (bucket === "promoters") whereClauses.push(gte(npsResponseTable.score, 9));
  else if (bucket === "passives")
    whereClauses.push(
      and(gte(npsResponseTable.score, 7), lte(npsResponseTable.score, 8)),
    );
  else if (bucket === "detractors") whereClauses.push(lte(npsResponseTable.score, 6));
  if (fromDate) whereClauses.push(gte(npsResponseTable.created_at, fromDate));
  if (toDate) whereClauses.push(lte(npsResponseTable.created_at, toDate));

  // Paginate after dropping Hackatime-banned authors so pages have no holes.
  const candidates = await db
    .select({
      id: npsResponseTable.id,
      user_id: npsResponseTable.user_id,
      resolved_at: npsResponseTable.resolved_at,
      created_at: npsResponseTable.created_at,
    })
    .from(npsResponseTable)
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(desc(npsResponseTable.created_at));

  const distinctUserIds = Array.from(
    new Set(candidates.map((c) => c.user_id).filter((v): v is string => !!v)),
  );
  const bannedIds = await getBannedUserIds(distinctUserIds);

  const allowed = candidates.filter((c) => !c.user_id || !bannedIds.has(c.user_id));

  let needsReplyByCandidate = new Map<number, boolean>();
  if (sort === "needs-reply" && allowed.length > 0) {
    const allowedIdsForReplies = allowed.map((c) => c.id);
    const latestReplyRows = await db.execute<{
      nps_response_id: number;
      is_inbound: boolean;
    }>(sql`
      SELECT DISTINCT ON (${npsResponseRepliesTable.nps_response_id})
        ${npsResponseRepliesTable.nps_response_id} AS nps_response_id,
        ${npsResponseRepliesTable.is_inbound} AS is_inbound
      FROM ${npsResponseRepliesTable}
      WHERE ${inArray(npsResponseRepliesTable.nps_response_id, allowedIdsForReplies)}
      ORDER BY ${npsResponseRepliesTable.nps_response_id}, ${npsResponseRepliesTable.created_at} DESC
    `);
    const latestInboundById = new Map<number, boolean>();
    for (const row of latestReplyRows.rows ?? latestReplyRows) {
      latestInboundById.set(Number(row.nps_response_id), !!row.is_inbound);
    }
    for (const c of allowed) {
      const isResolved = !!c.resolved_at;
      needsReplyByCandidate.set(c.id, (latestInboundById.get(c.id) ?? false) && !isResolved);
    }
  }

  const sortedAllowed =
    sort === "needs-reply"
      ? [...allowed].sort((a, b) => {
          const an = needsReplyByCandidate.get(a.id) ? 1 : 0;
          const bn = needsReplyByCandidate.get(b.id) ? 1 : 0;
          if (an !== bn) return bn - an;
          const at = a.created_at instanceof Date ? a.created_at.getTime() : new Date(a.created_at).getTime();
          const bt = b.created_at instanceof Date ? b.created_at.getTime() : new Date(b.created_at).getTime();
          return bt - at;
        })
      : allowed;

  const allowedIds = sortedAllowed.map((c) => c.id);
  const total = allowedIds.length;

  const offset = (page - 1) * pageSize;
  const pageIds = allowedIds.slice(offset, offset + pageSize);
  const resolver = alias(users, "resolver");
  const rows = pageIds.length === 0
    ? []
    : await db
        .select({
          id: npsResponseTable.id,
          score: npsResponseTable.score,
          doing_well: npsResponseTable.doing_well,
          can_improve: npsResponseTable.can_improve,
          anything_else: npsResponseTable.anything_else,
          created_at: npsResponseTable.created_at,
          resolved_at: npsResponseTable.resolved_at,
          resolver_id: resolver.id,
          resolver_name: resolver.name,
          resolver_image: resolver.image,
          user_id: users.id,
          user_name: users.name,
          user_image: users.image,
          user_slack_id: users.slack_id,
          user_username: users.username,
        })
        .from(npsResponseTable)
        .innerJoin(users, eq(users.id, npsResponseTable.user_id))
        .leftJoin(resolver, eq(resolver.id, npsResponseTable.resolved_by_user_id))
        .where(inArray(npsResponseTable.id, pageIds));

  // SELECT ... IN doesn't preserve pageIds order.
  const orderById = new Map<number, number>();
  pageIds.forEach((id, idx) => orderById.set(id, idx));
  rows.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));

  const submissionIds = rows.map((r) => r.id);
  const repliesByResponse = new Map<number, ReplyRow[]>();
  if (submissionIds.length > 0) {
    const responder = alias(users, "responder");
    const replyRows = await db
      .select({
        id: npsResponseRepliesTable.id,
        nps_response_id: npsResponseRepliesTable.nps_response_id,
        body: npsResponseRepliesTable.body,
        created_at: npsResponseRepliesTable.created_at,
        is_inbound: npsResponseRepliesTable.is_inbound,
        slack_message_ts: npsResponseRepliesTable.slack_message_ts,
        slack_error: npsResponseRepliesTable.slack_error,
        responder_id: responder.id,
        responder_name: responder.name,
        responder_image: responder.image,
      })
      .from(npsResponseRepliesTable)
      .leftJoin(responder, eq(responder.id, npsResponseRepliesTable.responder_user_id))
      .where(inArray(npsResponseRepliesTable.nps_response_id, submissionIds))
      .orderBy(asc(npsResponseRepliesTable.created_at));

    for (const rr of replyRows) {
      const list = repliesByResponse.get(rr.nps_response_id) ?? [];
      list.push({
        id: rr.id,
        body: rr.body,
        created_at:
          rr.created_at instanceof Date
            ? rr.created_at.toISOString()
            : String(rr.created_at),
        is_inbound: rr.is_inbound,
        slack_delivered: !!rr.slack_message_ts,
        slack_error: rr.slack_error ?? null,
        responder: rr.responder_id
          ? {
              id: rr.responder_id,
              name: rr.responder_name,
              image: rr.responder_image,
            }
          : null,
      });
      repliesByResponse.set(rr.nps_response_id, list);
    }
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      score: r.score,
      doing_well: r.doing_well,
      can_improve: r.can_improve,
      anything_else: r.anything_else,
      created_at:
        r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      resolved_at: r.resolved_at
        ? r.resolved_at instanceof Date
          ? r.resolved_at.toISOString()
          : String(r.resolved_at)
        : null,
      resolved_by: r.resolver_id
        ? {
            id: r.resolver_id,
            name: r.resolver_name,
            image: r.resolver_image,
          }
        : null,
      user: {
        id: r.user_id,
        name: r.user_name,
        image: r.user_image,
        slack_id: r.user_slack_id,
        username: r.user_username,
      },
      replies: repliesByResponse.get(r.id) ?? [],
    })),
    total,
    page,
    pageSize,
    totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    filters: {
      bucket,
      sort,
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
    },
  };
});
