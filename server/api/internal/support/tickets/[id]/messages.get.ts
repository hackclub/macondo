import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import db from "../../../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../../../../db/schema";
import { canAccessInternalSupport } from "../../../../../policies/internal";

// Lets the realtime client drain missed messages after a reconnect; no `since` returns all of them.
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
    .select({ id: supportTicketTable.id })
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);
  if (!ticket) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  const sinceRaw = Number(getQuery(event).since);
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;

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
    .where(
      since > 0
        ? and(eq(supportTicketMessageTable.ticket_id, id), gt(supportTicketMessageTable.id, since))
        : eq(supportTicketMessageTable.ticket_id, id),
    )
    .orderBy(asc(supportTicketMessageTable.id));

  const messageIds = messages.map((m) => m.id);
  return {
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
