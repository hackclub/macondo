import { asc, eq, inArray, sql } from "drizzle-orm";

import db from "../../../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../../../../db/schema";
import { canAccessInternalSupport, isSupportOnly } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);

  if (!ticket) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  const [authorRow, claimedByRow, resolvedByRow] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, image: users.image, slack_id: users.slack_id })
      .from(users)
      .where(eq(users.id, ticket.user_id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    ticket.claimed_by_user_id
      ? db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(eq(users.id, ticket.claimed_by_user_id))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    ticket.resolved_by_user_id
      ? db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(eq(users.id, ticket.resolved_by_user_id))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Support-only staff don't see PII; slack_id stays because Slack threads need it.
  const author = authorRow
    ? isSupportOnly(actor)
      ? { id: authorRow.id, name: authorRow.name, email: null, image: authorRow.image, slack_id: authorRow.slack_id }
      : authorRow
    : null;

  const messages = await db
    .select({
      id: supportTicketMessageTable.id,
      body: supportTicketMessageTable.body,
      author_user_id: supportTicketMessageTable.author_user_id,
      author_kind: supportTicketMessageTable.author_kind,
      is_internal_note: supportTicketMessageTable.is_internal_note,
      slack_ts: supportTicketMessageTable.slack_ts,
      client_dedup_key: supportTicketMessageTable.client_dedup_key,
      created_at: supportTicketMessageTable.created_at,
      edited_at: supportTicketMessageTable.edited_at,
      deleted_at: supportTicketMessageTable.deleted_at,
      original_body: supportTicketMessageTable.original_body,
      // Fall back to the captured Slack identity for slack_external rows
      // (community members with no linked Macondo account).
      author_name: sql<string | null>`coalesce(${users.name}, ${supportTicketMessageTable.slack_author_name})`,
      author_image: sql<string | null>`coalesce(${users.image}, ${supportTicketMessageTable.slack_author_image})`,
    })
    .from(supportTicketMessageTable)
    .leftJoin(users, eq(users.id, supportTicketMessageTable.author_user_id))
    .where(eq(supportTicketMessageTable.ticket_id, id))
    .orderBy(asc(supportTicketMessageTable.id));

  const messageIds = messages.map((m) => m.id);
  return {
    ticket,
    author,
    claimed_by: claimedByRow,
    resolved_by: resolvedByRow,
    messages,
    attachments:
      messageIds.length > 0
        ? await db
            .select()
            .from(supportTicketAttachmentTable)
            .where(inArray(supportTicketAttachmentTable.message_id, messageIds))
        : [],
  };
});
