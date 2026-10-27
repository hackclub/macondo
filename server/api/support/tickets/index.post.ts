import { eq } from "drizzle-orm";

import db from "../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
} from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { fetchSlackProfile } from "../../../lib/slack";
import { getSession } from "../../../lib/session";
import { runSupportKbAnswerForNewTicket } from "../../../lib/support-kb-answer";
import { runCapybaraForNewTicket } from "../../../lib/support-ticket-embedding";
import { publishQueueChanged } from "../../../lib/support-ticket-realtime";
import { postBtsMessage } from "../../../lib/support-ticket-slack";
import { useRuntimeConfig } from "#imports";

type CreateBody = {
  subject?: string;
  body?: string;
  category?: string;
  priority?: string;
  related_ship_id?: number | null;
  related_project_id?: number | null;
  attachments?: Array<{
    url: string;
    filename: string;
    size_bytes?: number;
    mime_type?: string;
    sha?: string;
  }>;
};

const VALID_CATEGORIES = ["project", "payout", "account", "shop", "bug", "other"] as const;
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type Category = (typeof VALID_CATEGORIES)[number];
type Priority = (typeof VALID_PRIORITIES)[number];

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = await readBody<CreateBody>(event);
  const subject = body?.subject?.trim();
  const messageBody = body?.body?.trim();

  if (!subject || subject.length < 3) {
    throw createError({ statusCode: 400, statusMessage: "Subject is required (min 3 chars)" });
  }
  if (!messageBody || messageBody.length < 3) {
    throw createError({ statusCode: 400, statusMessage: "Body is required (min 3 chars)" });
  }
  if (subject.length > 200) {
    throw createError({ statusCode: 400, statusMessage: "Subject too long (max 200 chars)" });
  }

  const category: Category =
    VALID_CATEGORIES.includes(body?.category as Category)
      ? (body!.category as Category)
      : "other";
  const priority: Priority =
    VALID_PRIORITIES.includes(body?.priority as Priority)
      ? (body!.priority as Priority)
      : "normal";

  const config = useRuntimeConfig();

  const [ticket] = await db
    .insert(supportTicketTable)
    .values({
      user_id: user.id,
      subject,
      body: messageBody,
      category,
      priority,
      status: "open",
      related_ship_id: body?.related_ship_id ?? null,
      related_project_id: body?.related_project_id ?? null,
      bts_channel_id: (config.slackSupportBtsChannelId as string | undefined) ?? null,
    })
    .returning();

  if (!ticket) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create ticket" });
  }

  const [firstMessage] = await db
    .insert(supportTicketMessageTable)
    .values({
      ticket_id: ticket.id,
      author_user_id: user.id,
      body: messageBody,
      is_internal_note: false,
    })
    .returning({ id: supportTicketMessageTable.id });

  if (firstMessage && body?.attachments && body.attachments.length > 0) {
    await db.insert(supportTicketAttachmentTable).values(
      body.attachments.map((a) => ({
        message_id: firstMessage.id,
        url: a.url,
        filename: a.filename,
        size_bytes: a.size_bytes ?? null,
        mime_type: a.mime_type ?? null,
        sha: a.sha ?? null,
      })),
    );
  }

  try {
    await writeAudit({
      actor_id: user.id,
      action: "support_ticket.created",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: null,
      new_value: {
        subject,
        category,
        priority,
        related_ship_id: ticket.related_ship_id,
        related_project_id: ticket.related_project_id,
      },
      sensitive: false,
      public_message: `Ticket #${ticket.id} created via web`,
      change_summary: subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit create failed", err);
  }

  void publishQueueChanged(ticket.id, ticket.user_id, "ticket_created");

  void (async () => {
    try {
      let avatarUrl: string | null = null;
      let displayName: string | null = user.name ?? null;
      if (user.slack_id) {
        const profile = await fetchSlackProfile(user.slack_id);
        avatarUrl = profile.image;
        displayName = profile.username ?? displayName;
      }
      const res = await postBtsMessage({
        id: ticket.id,
        subject,
        body: messageBody,
        status: "open",
        priority,
        category,
        author_display_name: displayName,
        author_avatar_url: avatarUrl,
      });
      if (res.ts) {
        await db
          .update(supportTicketTable)
          .set({ bts_message_ts: res.ts, updated_at: new Date() })
          .where(eq(supportTicketTable.id, ticket.id));
      }
    } catch (err) {
      console.error("[support-ticket] BTS post failed", ticket.id, err);
    }
  })();

  // The KB agent only auto-replies when confident; otherwise fall back to Capybara's similar-ticket links.
  void (async () => {
    try {
      if (!(await runSupportKbAnswerForNewTicket(ticket.id))) {
        await runCapybaraForNewTicket(ticket.id);
      }
    } catch (err) {
      console.error("[support-ticket] supporter/capybara run threw", ticket.id, err);
      try {
        await writeAudit({
          actor_id: user.id,
          action: "support_ticket.capybara_failed",
          entity_type: "support_ticket",
          entity_id: String(ticket.id),
          old_value: null,
          new_value: { error: String(err) },
          sensitive: true,
          public_message: null,
          change_summary: "Capybara similar-ticket run failed",
        });
      } catch (auditErr) {
        console.error(
          "[support-ticket] capybara audit failed",
          ticket.id,
          auditErr,
        );
      }
    }
  })();

  return ticket;
});
