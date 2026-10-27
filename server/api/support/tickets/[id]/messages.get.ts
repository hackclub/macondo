import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../../../db/schema";
import { getSession } from "../../../../lib/session";

// ?since={id} lets the realtime client fill gaps after a websocket reconnect.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const [ticket] = await db
    .select({ user_id: supportTicketTable.user_id })
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);
  if (!ticket || ticket.user_id !== user.id) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  const sinceRaw = Number(getQuery(event).since);
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;

  const visible = (
    await db
      .select({
        id: supportTicketMessageTable.id,
        body: supportTicketMessageTable.body,
        author_user_id: supportTicketMessageTable.author_user_id,
        author_kind: supportTicketMessageTable.author_kind,
        is_internal_note: supportTicketMessageTable.is_internal_note,
        client_dedup_key: supportTicketMessageTable.client_dedup_key,
        created_at: supportTicketMessageTable.created_at,
        // Slack identity fallback for community members with no Macondo account.
        author_name: sql<string | null>`coalesce(${users.username}, ${supportTicketMessageTable.slack_author_name})`,
        author_image: sql<string | null>`coalesce(${users.image}, ${supportTicketMessageTable.slack_author_image})`,
      })
      .from(supportTicketMessageTable)
      .leftJoin(users, eq(users.id, supportTicketMessageTable.author_user_id))
      .where(
        since > 0
          ? and(eq(supportTicketMessageTable.ticket_id, id), gt(supportTicketMessageTable.id, since))
          : eq(supportTicketMessageTable.ticket_id, id),
      )
      .orderBy(asc(supportTicketMessageTable.id))
  ).filter((m) => !m.is_internal_note);
  const messageIds = visible.map((m) => m.id);

  return {
    messages: visible,
    attachments:
      messageIds.length > 0
        ? await db
            .select()
            .from(supportTicketAttachmentTable)
            .where(inArray(supportTicketAttachmentTable.message_id, messageIds))
        : [],
  };
});
