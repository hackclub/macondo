import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import db from "../../../../db";
import { supportTicketTable, users } from "../../../../db/schema";
import { canAccessInternalSupport, isSupportOnly } from "../../../../policies/internal";

// Priority falls back to most-recently-updated so same-priority pages stay stably ordered.
function orderByForSort(sort: string): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(supportTicketTable.created_at), asc(supportTicketTable.id)];
    case "updated":
      return [desc(supportTicketTable.updated_at), desc(supportTicketTable.id)];
    case "priority":
      return [
        sql`CASE ${supportTicketTable.priority}
              WHEN 'urgent' THEN 0
              WHEN 'high' THEN 1
              WHEN 'normal' THEN 2
              WHEN 'low' THEN 3
              ELSE 4 END`,
        desc(supportTicketTable.updated_at),
        desc(supportTicketTable.id),
      ];
    case "newest":
    default:
      return [desc(supportTicketTable.created_at), desc(supportTicketTable.id)];
  }
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const statusFilter = typeof query.status === "string" ? query.status : null;
  const categoryFilter = typeof query.category === "string" ? query.category : null;
  const priorityFilter = typeof query.priority === "string" ? query.priority : null;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
  const page = Math.max(1, Number(query.page) || 1);

  const wheres: SQL<unknown>[] = [];
  if (statusFilter) {
    wheres.push(sql`${supportTicketTable.status} = ${statusFilter}`);
  }
  if (categoryFilter) {
    wheres.push(sql`${supportTicketTable.category} = ${categoryFilter}`);
  }
  if (priorityFilter) {
    wheres.push(sql`${supportTicketTable.priority} = ${priorityFilter}`);
  }
  if (query.mine === "1" || query.mine === "true") {
    wheres.push(eq(supportTicketTable.claimed_by_user_id, actor.id));
  }
  if (q.length > 0) {
    const pattern = `%${q}%`;
    wheres.push(
      sql`(${supportTicketTable.subject} ILIKE ${pattern} OR ${supportTicketTable.body} ILIKE ${pattern})`,
    );
  }

  const whereClause = wheres.length > 0 ? and(...wheres) : undefined;
  const claimerUsers = alias(users, "claimer_users");

  // The count needs no joins since every filter lives on the ticket table.
  const [rawRows, countRows] = await Promise.all([
    db
      .select({
        id: supportTicketTable.id,
        user_id: supportTicketTable.user_id,
        subject: supportTicketTable.subject,
        category: supportTicketTable.category,
        priority: supportTicketTable.priority,
        status: supportTicketTable.status,
        claimed_by_user_id: supportTicketTable.claimed_by_user_id,
        claimed_at: supportTicketTable.claimed_at,
        resolved_at: supportTicketTable.resolved_at,
        csat_rating: supportTicketTable.csat_rating,
        created_at: supportTicketTable.created_at,
        updated_at: supportTicketTable.updated_at,
        author_name: users.name,
        author_email: users.email,
        author_image: users.image,
        claimed_by: {
          id: claimerUsers.id,
          username: claimerUsers.username,
        },
      })
      .from(supportTicketTable)
      .leftJoin(users, eq(users.id, supportTicketTable.user_id))
      .leftJoin(claimerUsers, eq(claimerUsers.id, supportTicketTable.claimed_by_user_id))
      .where(whereClause)
      .orderBy(...orderByForSort(typeof query.sort === "string" ? query.sort : "newest"))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: sql<number>`COUNT(*)::int`.mapWith(Number) })
      .from(supportTicketTable)
      .where(whereClause),
  ]);

  const rows = rawRows.map((r) => ({
    ...r,
    claimed_by: r.claimed_by?.id ? r.claimed_by : null,
  }));

  return {
    items: isSupportOnly(actor)
      ? rows.map((r) => ({ ...r, author_email: null }))
      : rows,
    page,
    limit,
    total: countRows[0]?.total ?? 0,
  };
});
