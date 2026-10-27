import { and, eq } from "drizzle-orm";

import db from "../../../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { notify } from "../../../../../lib/notify";
import { claimIfOpen } from "../../../../../lib/support-ticket-claim";
import { publishMessageAdded } from "../../../../../lib/support-ticket-realtime";
import { postPublicThreadReply } from "../../../../../lib/support-ticket-slack";
import { canAccessInternalSupport } from "../../../../../policies/internal";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

type StaffReplyBody = {
  body?: string;
  is_internal_note?: boolean;
  client_dedup_key?: string;
  attachments?: Array<{
    url: string;
    filename: string;
    size_bytes?: number;
    mime_type?: string;
    sha?: string;
  }>;
};

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const body = await readBody<StaffReplyBody>(event);
  const text = body?.body?.trim();
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: "Message body is required" });
  }
  const isInternalNote = body?.is_internal_note === true;
  const dedupKey =
    typeof body?.client_dedup_key === "string" &&
    body.client_dedup_key.length > 0 &&
    body.client_dedup_key.length <= 64 // max dedup key length
      ? body.client_dedup_key
      : null;

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);
  if (!ticket) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  // Idempotent retry: side effects already ran on the original submit.
  if (dedupKey) {
    const [existing] = await db
      .select({ id: supportTicketMessageTable.id })
      .from(supportTicketMessageTable)
      .where(
        and(
          eq(supportTicketMessageTable.ticket_id, id),
          eq(supportTicketMessageTable.client_dedup_key, dedupKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: true, id: existing.id, deduped: true };
    }
  }

  // Parallel submits with the same dedup key can both miss the pre-check;
  // on the unique violation (23505) re-read the winner's row.
  let message: { id: number } | undefined;
  try {
    const [inserted] = await db
      .insert(supportTicketMessageTable)
      .values({
        ticket_id: id,
        author_user_id: actor.id,
        body: text,
        is_internal_note: isInternalNote,
        client_dedup_key: dedupKey,
      })
      .returning({ id: supportTicketMessageTable.id });
    message = inserted;
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code
      ?? (err as { cause?: { code?: string } }).cause?.code;
    if (dedupKey && code === "23505") {
      const [existing] = await db
        .select({ id: supportTicketMessageTable.id })
        .from(supportTicketMessageTable)
        .where(
          and(
            eq(supportTicketMessageTable.ticket_id, id),
            eq(supportTicketMessageTable.client_dedup_key, dedupKey),
          ),
        )
        .limit(1);
      if (existing) {
        return { ok: true, id: existing.id, deduped: true };
      }
    }
    throw err;
  }

  // Public replies auto-claim; internal notes are often just staff discussion.
  // claimIfOpen owns the audit, BTS refresh and realtime push.
  if (!isInternalNote && ticket.status === "open") {
    await claimIfOpen(id, actor.id, "auto_on_reply");
  }

  const hasAttachments = !!(body?.attachments && body.attachments.length > 0);
  if (message && hasAttachments) {
    await db.insert(supportTicketAttachmentTable).values(
      body!.attachments!.map((a) => ({
        message_id: message.id,
        url: a.url,
        filename: a.filename,
        size_bytes: a.size_bytes ?? null,
        mime_type: a.mime_type ?? null,
        sha: a.sha ?? null,
      })),
    );
  }

  // Slack auto-unfurls cdn.hackclub.com URLs, so appending them shows the attachments.
  const slackText = hasAttachments
    ? [text, ...body!.attachments!.map((a) => a.url)].join("\n")
    : text;

  // A public reply clears the auto-resolve warning, re-arming the 48h window;
  // internal notes don't count as a staff answer.
  await db
    .update(supportTicketTable)
    .set(
      isInternalNote
        ? { updated_at: new Date() }
        : { updated_at: new Date(), auto_resolve_warned_at: null },
    )
    .where(eq(supportTicketTable.id, id));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: isInternalNote ? "support_ticket.internal_note" : "support_ticket.reply",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: null,
      new_value: { message_id: message?.id, body: text },
      sensitive: false,
      public_message: isInternalNote
        ? `Internal note added on ticket #${ticket.id}`
        : `Staff reply on ticket #${ticket.id}`,
      change_summary: ticket.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit reply failed", err);
  }

  // Internal notes are staff-only: no Slack mirror, no user notification.
  if (!isInternalNote) {
    // Spoof the bot's Slack identity so the reply appears authored by the staff member.
    const spoof = {
      username: actor.username ?? actor.email ?? undefined,
      icon_url: actor.image ?? undefined,
    };

    const hasPublicThread =
      !!ticket.slack_channel_id && !!ticket.slack_thread_ts;
    if (hasPublicThread) {
      void postPublicThreadReply({
        channel: ticket.slack_channel_id!,
        thread_ts: ticket.slack_thread_ts!,
        text: slackText,
        ...spoof,
      });
    }

    // Route via the dashboard so the notification opens the in-game ticket modal.
    const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${ticket.id}`;
    void notify({
      user_id: ticket.user_id,
      type: "ticket_reply",
      title: `New reply on: ${ticket.subject}`,
      body: text.length > 180 ? `${text.slice(0, 180)}...` : text, // notification preview length
      action_url: ticketUrl,
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      // Skip the DM when the reply already lands in the user's public thread.
      slack: hasPublicThread
        ? undefined
        : { text: `:speech_balloon: new reply on *${ticket.subject}*:\n>${text}\n<${ticketUrl}|Open ticket>` },
      email: {
        template: "ticket_reply",
        data: {
          ticket_subject: ticket.subject,
          staff_name: "Macondo support",
          reply_body: text,
          ticket_url: ticketUrl,
        },
      },
    });
  }

  // Publish last so subscribers reading the DB see a consistent ticket.
  if (message) {
    void publishMessageAdded(id, message.id);
  }

  return { ok: true, id: message?.id };
});
