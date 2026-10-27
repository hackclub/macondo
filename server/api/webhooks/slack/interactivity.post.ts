import { and, eq, sql } from "drizzle-orm";

import db from "../../../db";
import { supportTicketTable, users } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { notify } from "../../../lib/notify";
import { fetchSlackProfile } from "../../../lib/slack";
import { verifySignature } from "../../../lib/slack-bot";
import { draftKbSuggestionFromResolvedTicket } from "../../../lib/support-kb-curation";
import { ensureTicketEmbedded } from "../../../lib/support-ticket-embedding";
import {
  canResolveSupportTicket,
  postPublicThreadReply,
  reactResolvedOnOriginal,
  updateBtsMessage,
} from "../../../lib/support-ticket-slack";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

type InteractivityPayload = {
  type: string;
  user?: { id: string; name?: string };
  actions?: Array<{ action_id: string; value: string }>;
};

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event, "utf8");
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: "Empty body" });
  }

  if (
    !verifySignature({
      rawBody: raw,
      signature: getHeader(event, "x-slack-signature"),
      timestamp: getHeader(event, "x-slack-request-timestamp"),
    })
  ) {
    throw createError({ statusCode: 401, statusMessage: "Invalid signature" });
  }

  const payloadRaw = new URLSearchParams(raw).get("payload");
  if (!payloadRaw) return { ok: true };
  const payload = JSON.parse(payloadRaw) as InteractivityPayload;

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return { ok: true };
  }

  const slackUserId = payload.user?.id;
  if (!slackUserId) return { ok: true };

  const [actor] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.slack_id, slackUserId))
    .limit(1);

  for (const action of payload.actions) {
    const ticketId = Number(action.value);
    if (!Number.isInteger(ticketId)) continue;

    const actorId = actor?.id;
    const actorName =
      actor?.name ??
      (await fetchSlackProfile(slackUserId)).username ??
      "staff";

    if (action.action_id === "support_claim") {
      if (!actorId) continue;
      const [updated] = await db
        .update(supportTicketTable)
        .set({
          status: "claimed",
          claimed_by_user_id: actorId,
          claimed_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(supportTicketTable.id, ticketId),
            sql`${supportTicketTable.status} = 'open'`,
          ),
        )
        .returning();
      if (updated) {
        try {
          await writeAudit({
            actor_id: actorId,
            action: "support_ticket.claimed",
            entity_type: "support_ticket",
            entity_id: String(updated.id),
            old_value: { status: "open" },
            new_value: { status: "claimed", via: "slack_button" },
            sensitive: false,
            public_message: `Ticket #${updated.id} claimed via Slack`,
            change_summary: updated.subject,
          });
        } catch (err) {
          console.error("[support-ticket] audit slack claim button failed", err);
        }
        const [authorRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, updated.user_id))
          .limit(1);
        await updateBtsMessage({
          id: updated.id,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          priority: updated.priority,
          category: updated.category,
          claimed_by_name: actorName,
          resolved_by_name: null,
          author_display_name: authorRow?.name ?? null,
          author_avatar_url: null,
          slack_channel_id: updated.slack_channel_id,
          slack_thread_ts: updated.slack_thread_ts,
          bts_message_ts: updated.bts_message_ts,
        });
      }
    } else if (action.action_id === "support_resolve") {
      if (!actorId) continue;
      const [existing] = await db
        .select({ user_id: supportTicketTable.user_id })
        .from(supportTicketTable)
        .where(eq(supportTicketTable.id, ticketId))
        .limit(1);
      if (!existing) continue;
      if (
        !(await canResolveSupportTicket(
          { id: actorId, slack_id: slackUserId },
          existing,
        ))
      ) {
        continue;
      }
      const [updated] = await db
        .update(supportTicketTable)
        .set({
          status: "resolved",
          resolved_by_user_id: actorId,
          resolved_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(supportTicketTable.id, ticketId),
            sql`${supportTicketTable.status} IN ('open', 'claimed')`,
          ),
        )
        .returning();
      if (updated) {
        try {
          await writeAudit({
            actor_id: actorId,
            action: "support_ticket.resolved",
            entity_type: "support_ticket",
            entity_id: String(updated.id),
            old_value: null,
            new_value: { status: "resolved", via: "slack_button" },
            sensitive: false,
            public_message: `Ticket #${updated.id} resolved via Slack`,
            change_summary: updated.subject,
          });
        } catch (err) {
          console.error("[support-ticket] audit slack resolve button failed", err);
        }
        const [authorRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, updated.user_id))
          .limit(1);
        await updateBtsMessage({
          id: updated.id,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          priority: updated.priority,
          category: updated.category,
          claimed_by_name: null,
          resolved_by_name: actorName,
          author_display_name: authorRow?.name ?? null,
          author_avatar_url: null,
          slack_channel_id: updated.slack_channel_id,
          slack_thread_ts: updated.slack_thread_ts,
          bts_message_ts: updated.bts_message_ts,
        });

        const hasPublicThread =
          !!updated.slack_channel_id && !!updated.slack_thread_ts;
        if (hasPublicThread) {
          void postPublicThreadReply({
            channel: updated.slack_channel_id!,
            thread_ts: updated.slack_thread_ts!,
            text: ":white_check_mark: This ticket has been marked resolved. If you still need help, reply here within 7 days to reopen it.",
          });
          void reactResolvedOnOriginal({
            slack_channel_id: updated.slack_channel_id,
            slack_thread_ts: updated.slack_thread_ts,
          });
        }

        const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${updated.id}`;
        void notify({
          user_id: updated.user_id,
          type: "ticket_resolved",
          title: `Ticket resolved: ${updated.subject}`,
          body: "Your ticket has been marked resolved.",
          action_url: ticketUrl,
          entity_type: "support_ticket",
          entity_id: String(updated.id),
          skip_channels: hasPublicThread ? ["slack"] : undefined,
          slack: hasPublicThread
            ? undefined
            : {
                text: `:white_check_mark: Your ticket *${updated.subject}* has been resolved.`,
              },
          email: {
            template: "ticket_resolved",
            data: { ticket_subject: updated.subject, ticket_url: ticketUrl },
          },
        });

        // Only resolved tickets are suggested, so a missing embedding silently excludes this one.
        void ensureTicketEmbedded(updated.id);

        void draftKbSuggestionFromResolvedTicket(updated.id);
      }
    }
  }

  return { ok: true };
});
