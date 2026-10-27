// Failures are swallowed: realtime is best-effort and must not fail the underlying DB write.

import { eq, inArray, sql } from "drizzle-orm";

import db from "../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  users,
} from "../db/schema";
import { publishEvent } from "./realtime";

type StatusEvent = {
  status: string;
  claimed_by_user_id?: string | null;
  resolved_by_user_id?: string | null;
  actorUserId?: string | null;
};

export async function publishMessageAdded(
  ticketId: number,
  messageId: number,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: supportTicketMessageTable.id,
        body: supportTicketMessageTable.body,
        author_user_id: supportTicketMessageTable.author_user_id,
        author_kind: supportTicketMessageTable.author_kind,
        is_internal_note: supportTicketMessageTable.is_internal_note,
        slack_ts: supportTicketMessageTable.slack_ts,
        client_dedup_key: supportTicketMessageTable.client_dedup_key,
        created_at: supportTicketMessageTable.created_at,
        // slack_external rows have no linked user, so fall back to the captured Slack identity
        author_name: sql<string | null>`coalesce(${users.username}, ${supportTicketMessageTable.slack_author_name})`,
        author_image: sql<string | null>`coalesce(${users.image}, ${supportTicketMessageTable.slack_author_image})`,
      })
      .from(supportTicketMessageTable)
      .leftJoin(users, eq(users.id, supportTicketMessageTable.author_user_id))
      .where(eq(supportTicketMessageTable.id, messageId))
      .limit(1);
    if (!row) return;

    const attachments = await db
      .select()
      .from(supportTicketAttachmentTable)
      .where(inArray(supportTicketAttachmentTable.message_id, [messageId]));

    await publishEvent(`ticket:${ticketId}`, {
      type: "message_added",
      ticketId,
      message: row,
      attachments,
    });

    // the queue's updated_at and status pill can change too (auto-claim)
    await publishEvent("tickets:queue:internal", {
      type: "ticket_changed",
      ticketId,
      reason: "message_added",
    });
  } catch (err) {
    console.warn("[support-ticket-realtime] publishMessageAdded failed", err);
  }
}

export async function publishMessageEdited(
  ticketId: number,
  messageId: number,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: supportTicketMessageTable.id,
        body: supportTicketMessageTable.body,
        edited_at: supportTicketMessageTable.edited_at,
        deleted_at: supportTicketMessageTable.deleted_at,
        original_body: supportTicketMessageTable.original_body,
      })
      .from(supportTicketMessageTable)
      .where(eq(supportTicketMessageTable.id, messageId))
      .limit(1);
    if (!row) return;
    await publishEvent(`ticket:${ticketId}`, {
      type: "message_edited",
      ticketId,
      message: row,
    });
  } catch (err) {
    console.warn("[support-ticket-realtime] publishMessageEdited failed", err);
  }
}

export async function publishMessageDeleted(
  ticketId: number,
  messageId: number,
): Promise<void> {
  try {
    await publishEvent(`ticket:${ticketId}`, {
      type: "message_deleted",
      ticketId,
      messageId,
    });
  } catch (err) {
    console.warn("[support-ticket-realtime] publishMessageDeleted failed", err);
  }
}

export async function publishStatusChanged(
  ticketId: number,
  ownerUserId: string,
  evt: StatusEvent,
): Promise<void> {
  try {
    await publishEvent(`ticket:${ticketId}`, {
      type: "status_changed",
      ticketId,
      ...evt,
    });
    await publishEvent("tickets:queue:internal", {
      type: "ticket_changed",
      ticketId,
      reason: "status_changed",
    });
    await publishEvent(`tickets:queue:user:${ownerUserId}`, {
      type: "ticket_changed",
      ticketId,
      reason: "status_changed",
    });
  } catch (err) {
    console.warn("[support-ticket-realtime] publishStatusChanged failed", err);
  }
}

export async function publishQueueChanged(
  ticketId: number,
  ownerUserId: string,
  reason: string,
): Promise<void> {
  try {
    await publishEvent("tickets:queue:internal", {
      type: "ticket_changed",
      ticketId,
      reason,
    });
    await publishEvent(`tickets:queue:user:${ownerUserId}`, {
      type: "ticket_changed",
      ticketId,
      reason,
    });
  } catch (err) {
    console.warn("[support-ticket-realtime] publishQueueChanged failed", err);
  }
}
