import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import db from "../../../../db";
import {
  npsResponseRepliesTable,
  npsResponseTable,
  users,
} from "../../../../db/schema";
import { canAccessInternalStats } from "../../../../policies/internal";

export type NpsSubmissionDetail = {
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
  replies: Array<{
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
  }>;
};

export default defineEventHandler(async (event): Promise<NpsSubmissionDetail> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid submission id" });
  }

  const resolver = alias(users, "resolver");
  const [row] = await db
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
    .where(eq(npsResponseTable.id, id))
    .limit(1);

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Submission not found" });
  }

  const responder = alias(users, "responder");
  const replyRows = await db
    .select({
      id: npsResponseRepliesTable.id,
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
    .where(eq(npsResponseRepliesTable.nps_response_id, id))
    .orderBy(asc(npsResponseRepliesTable.created_at));

  return {
    id: row.id,
    score: row.score,
    doing_well: row.doing_well,
    can_improve: row.can_improve,
    anything_else: row.anything_else,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    resolved_at: row.resolved_at
      ? row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : String(row.resolved_at)
      : null,
    resolved_by: row.resolver_id
      ? {
          id: row.resolver_id,
          name: row.resolver_name,
          image: row.resolver_image,
        }
      : null,
    user: {
      id: row.user_id,
      name: row.user_name,
      image: row.user_image,
      slack_id: row.user_slack_id,
      username: row.user_username,
    },
    replies: replyRows.map((r) => ({
      id: r.id,
      body: r.body,
      created_at:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
      is_inbound: r.is_inbound,
      slack_delivered: !!r.slack_message_ts,
      slack_error: r.slack_error ?? null,
      responder: r.responder_id
        ? {
            id: r.responder_id,
            name: r.responder_name,
            image: r.responder_image,
          }
        : null,
    })),
  };
});
