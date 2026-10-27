import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import db from "../../../db";
import {
  npsResponseRepliesTable,
  npsResponseTable,
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { classifyAsHelpQuestion } from "../../../lib/help-question-classifier";
import {
  enforceMacondoBanInSlack,
  getActiveMacondoBan,
} from "../../../lib/macondo-ban";
import { notify } from "../../../lib/notify";
import { getRedis } from "../../../lib/redis";
import { fetchSlackProfile } from "../../../lib/slack";
import {
  conversationsReplies,
  type SlackFile,
  verifySignature,
} from "../../../lib/slack-bot";
import {
  attachmentsFromSlackFiles,
  ensureTicketForSlackMessage,
  isMessageSubtypeAllowed,
} from "../../../lib/support-ticket-backfill";
import { buildMirroredSlackReplyValues } from "../../../lib/support-ticket-mirror";
import { claimIfOpen } from "../../../lib/support-ticket-claim";
import { ensureTicketEmbedded } from "../../../lib/support-ticket-embedding";
import {
  publishMessageAdded,
  publishMessageDeleted,
  publishMessageEdited,
  publishStatusChanged,
} from "../../../lib/support-ticket-realtime";
import {
  canResolveSupportTicket,
  isSupportTeamSlackMember,
  postBtsThreadReply,
  postPublicThreadReply,
  reactResolvedOnOriginal,
  TICKET_RESOLVE_REACTION,
  updateBtsMessage,
} from "../../../lib/support-ticket-slack";
import { useRuntimeConfig } from "#imports";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

type SlackMessageEvent = {
  type: string;
  event_ts?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFile[];
  // message_changed nests the new message under `message` and the prior one under `previous_message`.
  message?: { ts?: string; text?: string; user?: string; edited?: { ts: string } };
  previous_message?: { ts?: string; text?: string; user?: string };
  deleted_ts?: string;
};

type SlackReactionEvent = {
  type: "reaction_added" | "reaction_removed";
  user: string;
  reaction: string;
  item: { type: string; channel: string; ts: string };
};

type SlackMemberJoinedEvent = {
  type: "member_joined_channel";
  user: string;
  channel: string;
};

type SlackEventEnvelope =
  | { type: "url_verification"; challenge: string }
  | {
      type: "event_callback";
      event_id?: string;
      event?: SlackMessageEvent | SlackReactionEvent | SlackMemberJoinedEvent;
    };

async function alreadyProcessed(eventId: string | undefined): Promise<boolean> {
  if (!eventId) return false;
  const redis = await getRedis();
  if (!redis) return false;
  const key = `slack:event:${eventId}`;
  if (await redis.get(key)) return true;
  await redis.set(key, "1", { EX: 300 }); // remember event ids for 5 minutes
  return false;
}

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

  const payload = JSON.parse(raw) as SlackEventEnvelope;

  if (payload.type === "url_verification") {
    return { challenge: payload.challenge };
  }

  if (payload.type !== "event_callback" || !payload.event) {
    return { ok: true };
  }

  const evt = payload.event;

  if (evt.type === "reaction_added") {
    if (await alreadyProcessed(payload.event_id)) {
      return { ok: true, dedup: true };
    }
    await handleResolveReaction(evt as SlackReactionEvent);
    return { ok: true, reaction: true };
  }

  // Kicks banned users straight back out so a ban is sticky against re-joining.
  if (evt.type === "member_joined_channel") {
    if (await alreadyProcessed(payload.event_id)) {
      return { ok: true, dedup: true };
    }
    await handleMemberJoinedChannel(evt as SlackMemberJoinedEvent);
    return { ok: true, memberJoined: true };
  }

  const msg = evt as SlackMessageEvent;
  if (msg.type !== "message") return { ok: true };
  if (msg.bot_id) return { ok: true };

  // Edits/deletes must be handled before the subtype allowlist, which would drop them.
  if (msg.subtype === "message_changed") {
    if (await alreadyProcessed(payload.event_id)) {
      return { ok: true, dedup: true };
    }
    await handleMessageChanged(msg);
    return { ok: true, edited: true };
  }
  if (msg.subtype === "message_deleted") {
    if (await alreadyProcessed(payload.event_id)) {
      return { ok: true, dedup: true };
    }
    await handleMessageDeleted(msg);
    return { ok: true, deleted: true };
  }

  if (!isMessageSubtypeAllowed(msg.subtype)) return { ok: true };

  if (await alreadyProcessed(payload.event_id)) {
    return { ok: true, dedup: true };
  }

  const config = useRuntimeConfig();
  const btsChannel = config.slackSupportBtsChannelId as string | undefined;
  const publicChannel = config.slackSupportPublicChannelId as string | undefined;
  const mentionChannel = config.slackMacondoMentionChannelId as string | undefined;
  if (!msg.user || !msg.ts || !msg.channel) return { ok: true };
  // A caption-less file_share is still a real question, so keep messages with text OR files.
  if (!msg.text && !(msg.files && msg.files.length > 0)) return { ok: true };

  const isThreadReply = !!msg.thread_ts && msg.thread_ts !== msg.ts;

  if (publicChannel && msg.channel === publicChannel) {
    if (!isThreadReply) {
      await handleNewTicketFromSlack(msg);
      return { ok: true, created: true };
    }
    await handlePublicThreadReplyFromStudent(msg);
    return { ok: true, studentThread: true };
  }

  if (btsChannel && msg.channel === btsChannel && isThreadReply) {
    await handleThreadedReplyFromStaff(msg);
    return { ok: true, threaded: true };
  }

  if (mentionChannel && msg.channel === mentionChannel && !isThreadReply) {
    if (/\bmacondo\b/i.test(msg.text)) {
      if (await classifyAsHelpQuestion(msg.text)) {
        await handleNewTicketFromSlack(msg);
        return { ok: true, autoFiledFromMention: true };
      }
      return { ok: true, mentionScanned: true, autoFiled: false };
    }
    return { ok: true, mentionIgnored: true };
  }

  // A DM may answer a Macondo-initiated NPS thread.
  if (msg.channel_type === "im") {
    if (await handleInboundNpsDm(msg)) return { ok: true, nps_inbound: true };
    return { ok: true, im_ignored: true };
  }

  return { ok: true };
});

// enforceMacondoBanInSlack never throws, so a Slack hiccup can't fail the webhook ack.
async function handleMemberJoinedChannel(
  evt: SlackMemberJoinedEvent,
): Promise<void> {
  if (!evt.user || !evt.channel) return;

  const config = useRuntimeConfig();
  const mainChannel = config.slackMacondoMainChannelId as string | undefined;
  if (!mainChannel || evt.channel !== mainChannel) return;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.slack_id, evt.user))
    .limit(1);
  if (!user) return;

  const ban = await getActiveMacondoBan(user.id);
  if (!ban) return;

  await enforceMacondoBanInSlack({
    slackId: evt.user,
    reason: ban.reason,
    expiresAt: ban.expires_at ?? null,
  });
}

async function handleResolveReaction(
  evt: SlackReactionEvent,
): Promise<void> {
  if (evt.reaction !== TICKET_RESOLVE_REACTION) return;

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(
      and(
        eq(supportTicketTable.slack_channel_id, evt.item.channel),
        eq(supportTicketTable.slack_thread_ts, evt.item.ts),
      ),
    )
    .limit(1);
  if (!ticket) return;
  if (ticket.status === "resolved" || ticket.status === "closed") return;

  const actor = await resolveSlackAuthor(evt.user);
  if (!actor.user_id) return;

  if (
    !(await canResolveSupportTicket(
      { id: actor.user_id, slack_id: evt.user },
      ticket,
    ))
  ) {
    return;
  }

  // The status filter stops the resolve notice firing twice on already-resolved tickets or races.
  const now = new Date();
  const [updated] = await db
    .update(supportTicketTable)
    .set({
      status: "resolved",
      resolved_by_user_id: actor.user_id,
      resolved_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(supportTicketTable.id, ticket.id),
        sql`${supportTicketTable.status} IN ('open', 'claimed')`,
      ),
    )
    .returning({ id: supportTicketTable.id });
  if (!updated) return;

  try {
    await writeAudit({
      actor_id: actor.user_id,
      action: "support_ticket.resolved",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: { status: ticket.status },
      new_value: { status: "resolved", via: "slack_reaction" },
      sensitive: false,
      public_message: `Ticket #${ticket.id} resolved via :${TICKET_RESOLVE_REACTION}: reaction`,
      change_summary: ticket.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit reaction resolve failed", err);
  }

  void publishStatusChanged(ticket.id, ticket.user_id, {
    status: "resolved",
    resolved_by_user_id: actor.user_id,
    actorUserId: actor.user_id,
  });

  await refreshBtsAndNotifyResolve(
    ticket.id,
    actor.name ?? "staff",
    evt.user,
  );
}

async function resolveSlackAuthor(slackUserId: string): Promise<{
  user_id: string | null;
  name: string | null;
  username: string | null;
  avatar: string | null;
}> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      image: users.image,
    })
    .from(users)
    .where(eq(users.slack_id, slackUserId))
    .limit(1);
  if (row) {
    return {
      user_id: row.id,
      name: row.name,
      username: row.username,
      avatar: row.image,
    };
  }
  const profile = await fetchSlackProfile(slackUserId);
  return {
    user_id: null,
    name: profile.username,
    username: profile.username,
    avatar: profile.image,
  };
}

async function handleNewTicketFromSlack(msg: SlackMessageEvent): Promise<void> {
  if (!msg.user || !msg.ts || !msg.channel) return;
  if (!msg.text && !(msg.files && msg.files.length > 0)) return;

  const result = await ensureTicketForSlackMessage({
    channel: msg.channel,
    ts: msg.ts,
    text: msg.text ?? "",
    user: msg.user,
    files: msg.files,
  });

  if (!result.ticket_id && result.reason === "unknown slack user") {
    console.warn("[slack-events] unknown slack user posted in help channel", msg.user);
  }
}

async function handleThreadedReplyFromStaff(msg: SlackMessageEvent): Promise<void> {
  if (!msg.user || !msg.text || !msg.thread_ts) return;

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(
      and(
        eq(supportTicketTable.bts_channel_id, msg.channel ?? ""),
        eq(supportTicketTable.bts_message_ts, msg.thread_ts),
      ),
    )
    .limit(1);
  if (!ticket) return;

  const author = await resolveSlackAuthor(msg.user);
  const trimmed = msg.text.trim();

  if (trimmed === "?resolve") {
    if (!author.user_id) return;
    if (
      !(await canResolveSupportTicket(
        { id: author.user_id, slack_id: msg.user },
        ticket,
      ))
    ) {
      // Silent drop: replying in the BTS thread would be noise.
      return;
    }
    // Same status filter as the other resolve paths so a double resolve doesn't re-fire notices.
    const [updated] = await db
      .update(supportTicketTable)
      .set({
        status: "resolved",
        resolved_by_user_id: author.user_id,
        resolved_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(supportTicketTable.id, ticket.id),
          sql`${supportTicketTable.status} IN ('open', 'claimed')`,
        ),
      )
      .returning({ id: supportTicketTable.id });
    if (!updated) return;
    try {
      await writeAudit({
        actor_id: author.user_id,
        action: "support_ticket.resolved",
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        old_value: { status: ticket.status },
        new_value: { status: "resolved", via: "slack_command" },
        sensitive: false,
        public_message: `Ticket #${ticket.id} resolved via Slack ?resolve`,
        change_summary: ticket.subject,
      });
    } catch (err) {
      console.error("[support-ticket] audit slack resolve failed", err);
    }
    void publishStatusChanged(ticket.id, ticket.user_id, {
      status: "resolved",
      resolved_by_user_id: author.user_id,
      actorUserId: author.user_id,
    });
    await refreshBtsAndNotifyResolve(ticket.id, author.name ?? "staff", msg.user);
    return;
  }

  if (trimmed === "?open") {
    if (!author.user_id) return;
    await db
      .update(supportTicketTable)
      .set({
        status: "open",
        resolved_by_user_id: null,
        resolved_at: null,
        updated_at: new Date(),
        // No owner message on reopen, so clear the warning or the sweep could insta-resolve it.
        auto_resolve_warned_at: null,
      })
      .where(eq(supportTicketTable.id, ticket.id));
    try {
      await writeAudit({
        actor_id: author.user_id,
        action: "support_ticket.reopened",
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        old_value: { status: ticket.status },
        new_value: { status: "open", via: "slack_command" },
        sensitive: false,
        public_message: `Ticket #${ticket.id} reopened via Slack ?open`,
        change_summary: ticket.subject,
      });
    } catch (err) {
      console.error("[support-ticket] audit slack reopen failed", err);
    }
    void publishStatusChanged(ticket.id, ticket.user_id, {
      status: "open",
      claimed_by_user_id: null,
      resolved_by_user_id: null,
      actorUserId: author.user_id,
    });
    await refreshBtsAfterStatusChange(ticket.id);
    return;
  }

  if (trimmed.startsWith("!")) {
    const publicText = trimmed.replace(/^!\s*/, "").trim();
    if (!publicText) return;
    if (!author.user_id) return;
    const [insertedMsg] = await db
      .insert(supportTicketMessageTable)
      .values({
        ticket_id: ticket.id,
        author_user_id: author.user_id,
        body: publicText,
        is_internal_note: false,
        slack_ts: msg.ts ?? null,
      })
      .returning({ id: supportTicketMessageTable.id });
    await db
      .update(supportTicketTable)
      .set({ updated_at: new Date(), auto_resolve_warned_at: null })
      .where(eq(supportTicketTable.id, ticket.id));
    // The BTS thread is staff-only, so a `!` reply means picking the ticket up.
    if (ticket.status === "open") {
      await claimIfOpen(ticket.id, author.user_id, "slack_bang");
    }
    try {
      await writeAudit({
        actor_id: author.user_id,
        action: "support_ticket.reply",
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        old_value: null,
        new_value: { message_id: insertedMsg?.id, via: "slack_bang", body: publicText },
        sensitive: false,
        public_message: `Staff reply on ticket #${ticket.id} via Slack !`,
        change_summary: ticket.subject,
      });
    } catch (err) {
      console.error("[support-ticket] audit slack ! reply failed", err);
    }

    if (insertedMsg) {
      void publishMessageAdded(ticket.id, insertedMsg.id);
    }

    if (ticket.slack_channel_id && ticket.slack_thread_ts) {
      void postPublicThreadReply({
        channel: ticket.slack_channel_id,
        thread_ts: ticket.slack_thread_ts,
        text: publicText,
      });
    }

    const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${ticket.id}`;
    void notify({
      user_id: ticket.user_id,
      type: "ticket_reply",
      title: `New reply on: ${ticket.subject}`,
      body: publicText.length > 180 ? `${publicText.slice(0, 180)}...` : publicText, // notification preview length
      action_url: ticketUrl,
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      // Slack-filed tickets already get the thread post, so skip the DM.
      slack: ticket.slack_channel_id
        ? undefined
        : {
            text: `:speech_balloon: ${author.username ?? "staff"}${msg.user ? ` (<@${msg.user}>)` : ""} replied on *${ticket.subject}*:\n>${publicText}\n<${ticketUrl}|Open ticket>`,
          },
      email: {
        template: "ticket_reply",
        data: {
          ticket_subject: ticket.subject,
          staff_name: author.username ?? "Macondo support",
          reply_body: publicText,
          ticket_url: ticketUrl,
        },
      },
    });
    return;
  }

  if (!author.user_id) return;
  const [noteRow] = await db
    .insert(supportTicketMessageTable)
    .values({
      ticket_id: ticket.id,
      author_user_id: author.user_id,
      body: trimmed,
      is_internal_note: true,
      slack_ts: msg.ts ?? null,
    })
    .returning({ id: supportTicketMessageTable.id });
  await db
    .update(supportTicketTable)
    .set({ updated_at: new Date() })
    .where(eq(supportTicketTable.id, ticket.id));
  try {
    await writeAudit({
      actor_id: author.user_id,
      action: "support_ticket.internal_note",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: null,
      new_value: { message_id: noteRow?.id, via: "slack_bts", body: trimmed },
      sensitive: false,
      public_message: `Internal note on ticket #${ticket.id} via Slack BTS thread`,
      change_summary: ticket.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit slack internal note failed", err);
  }

  if (noteRow) {
    void publishMessageAdded(ticket.id, noteRow.id);
  }
}

async function handlePublicThreadReplyFromStudent(
  msg: SlackMessageEvent,
): Promise<void> {
  if (!msg.user || !msg.thread_ts || !msg.channel) return;
  if (!msg.text && !(msg.files && msg.files.length > 0)) return;

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(
      and(
        eq(supportTicketTable.slack_channel_id, msg.channel),
        eq(supportTicketTable.slack_thread_ts, msg.thread_ts),
      ),
    )
    .limit(1);
  if (!ticket) {
    // The webhook missed the thread root; recover it from Slack, which also backfills this reply.
    try {
      const rootRes = await conversationsReplies({
        channel: msg.channel,
        ts: msg.thread_ts,
        limit: 1,
      });
      const root = rootRes.ok ? rootRes.messages[0] : null;
      if (root?.user && (root.text || (root.files && root.files.length > 0))) {
        await ensureTicketForSlackMessage({
          channel: msg.channel,
          ts: msg.thread_ts,
          text: root.text ?? "",
          user: root.user,
          files: root.files,
        });
      }
    } catch (err) {
      console.error("[support-ticket] orphaned thread reply recovery failed", err);
    }
    return;
  }

  const author = await resolveSlackAuthor(msg.user);

  // Community members without an account are still captured (author_kind 'slack_external').
  const [studentMsg] = await db
    .insert(supportTicketMessageTable)
    .values(
      buildMirroredSlackReplyValues({
        ticketId: ticket.id,
        slackUserId: msg.user,
        author,
        body: msg.text ?? "",
        slackTs: msg.ts ?? null,
      }),
    )
    .returning({ id: supportTicketMessageTable.id });

  if (studentMsg) {
    const replyAttachments = attachmentsFromSlackFiles(msg.files);
    if (replyAttachments.length > 0) {
      await db.insert(supportTicketAttachmentTable).values(
        replyAttachments.map((a) => ({ ...a, message_id: studentMsg.id })),
      );
    }
  }
  // Any public-thread reply supersedes a pending auto-resolve warning.
  await db
    .update(supportTicketTable)
    .set({ updated_at: new Date(), auto_resolve_warned_at: null })
    .where(eq(supportTicketTable.id, ticket.id));

  // Public thread, so only #macondo-support-team members claim; owners and community members must never become the handler.
  if (
    ticket.status === "open" &&
    author.user_id &&
    author.user_id !== ticket.user_id &&
    (await isSupportTeamSlackMember(msg.user))
  ) {
    await claimIfOpen(ticket.id, author.user_id, "slack_public");
  }

  // audit_logs.actor_id is NOT NULL, so replies from accountless community members aren't audited.
  if (author.user_id) {
    try {
      await writeAudit({
        actor_id: author.user_id,
        action: "support_ticket.student_reply",
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        old_value: null,
        new_value: { message_id: studentMsg?.id, via: "slack_public", body: msg.text },
        sensitive: false,
        public_message: `Student replied on ticket #${ticket.id} via Slack`,
        change_summary: ticket.subject,
      });
    } catch (err) {
      console.error("[support-ticket] audit slack student reply failed", err);
    }
  }

  if (studentMsg) {
    void publishMessageAdded(ticket.id, studentMsg.id);
  }

  // Only the owner's replies notify the claimer; no Slack DM since the public thread already pings them.
  if (
    author.user_id === ticket.user_id &&
    ticket.claimed_by_user_id &&
    ticket.claimed_by_user_id !== author.user_id
  ) {
    const replyText = msg.text?.trim() || "(attachment)";
    void notify({
      user_id: ticket.claimed_by_user_id,
      type: "ticket_reply",
      title: `New reply on #${ticket.id}: ${ticket.subject}`,
      body: replyText.length > 180 ? `${replyText.slice(0, 180)}...` : replyText, // notification preview length
      action_url: `/internal/support/${ticket.id}`,
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
    });
  }
}

async function refreshBtsAfterStatusChange(ticketId: number): Promise<void> {
  const [t] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, ticketId))
    .limit(1);
  if (!t) return;
  const [authorRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, t.user_id))
    .limit(1);
  await updateBtsMessage({
    id: t.id,
    subject: t.subject,
    body: t.body,
    status: t.status,
    priority: t.priority,
    category: t.category,
    claimed_by_name: null,
    resolved_by_name: null,
    author_display_name: authorRow?.name ?? null,
    author_avatar_url: null,
    slack_channel_id: t.slack_channel_id,
    slack_thread_ts: t.slack_thread_ts,
    bts_message_ts: t.bts_message_ts,
  });
}

async function refreshBtsAndNotifyResolve(
  ticketId: number,
  resolverName: string,
  resolverSlackId?: string,
): Promise<void> {
  const [t] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, ticketId))
    .limit(1);
  if (!t) return;

  const [authorRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, t.user_id))
    .limit(1);
  await updateBtsMessage({
    id: t.id,
    subject: t.subject,
    body: t.body,
    status: t.status,
    priority: t.priority,
    category: t.category,
    claimed_by_name: null,
    resolved_by_name: resolverName,
    author_display_name: authorRow?.name ?? null,
    author_avatar_url: null,
    slack_channel_id: t.slack_channel_id,
    slack_thread_ts: t.slack_thread_ts,
    bts_message_ts: t.bts_message_ts,
  });

  const hasPublicThread = !!t.slack_channel_id && !!t.slack_thread_ts;
  if (hasPublicThread) {
    void postPublicThreadReply({
      channel: t.slack_channel_id!,
      thread_ts: t.slack_thread_ts!,
      text: ":white_check_mark: This ticket has been marked resolved. If you still need help, reply here within 7 days to reopen it.",
    });
    void reactResolvedOnOriginal({
      slack_channel_id: t.slack_channel_id,
      slack_thread_ts: t.slack_thread_ts,
    });
  }

  const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${t.id}`;
  void notify({
    user_id: t.user_id,
    type: "ticket_resolved",
    title: `Ticket resolved: ${t.subject}`,
    body: "Your ticket has been marked resolved. Rate the response or reply if you still need help.",
    action_url: ticketUrl,
    entity_type: "support_ticket",
    entity_id: String(t.id),
    skip_channels: hasPublicThread ? ["slack"] : undefined,
    slack: hasPublicThread
      ? undefined
      : {
          text: `:white_check_mark: Your ticket *${t.subject}* has been resolved.`,
        },
    email: {
      template: "ticket_resolved",
      data: { ticket_subject: t.subject, ticket_url: ticketUrl },
    },
  });

  if (t.bts_message_ts) {
    void postBtsThreadReply({
      bts_message_ts: t.bts_message_ts,
      text: `:white_check_mark: Marked resolved by ${resolverName}${resolverSlackId ? ` (<@${resolverSlackId}>)` : ""}.`,
    });
  }

  // Only resolved tickets are suggested, so a missing embedding silently excludes this one.
  void ensureTicketEmbedded(t.id);
}

// Matches a threaded reply to the staff message it answers, else the author's latest NPS submission
// with a staff reply in this DM channel (users often type back without threading).
async function handleInboundNpsDm(msg: SlackMessageEvent): Promise<boolean> {
  if (!msg.user || !msg.text || !msg.ts || !msg.channel) return false;

  const [author] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.slack_id, msg.user))
    .limit(1);
  if (!author) return false;

  let npsResponseId: number | null = null;
  let threadRootTs: string | null = null;

  if (msg.thread_ts && msg.thread_ts !== msg.ts) {
    const [parent] = await db
      .select({
        nps_response_id: npsResponseRepliesTable.nps_response_id,
        slack_message_ts: npsResponseRepliesTable.slack_message_ts,
        slack_thread_root_ts: npsResponseRepliesTable.slack_thread_root_ts,
      })
      .from(npsResponseRepliesTable)
      .where(eq(npsResponseRepliesTable.slack_message_ts, msg.thread_ts))
      .limit(1);
    if (parent) {
      npsResponseId = parent.nps_response_id;
      threadRootTs = parent.slack_thread_root_ts ?? parent.slack_message_ts ?? null;
    }
  }

  if (npsResponseId == null) {
    // Constrained to this DM channel to avoid cross-contamination from other staff DMs.
    const [latest] = await db
      .select({
        nps_response_id: npsResponseRepliesTable.nps_response_id,
        slack_message_ts: npsResponseRepliesTable.slack_message_ts,
        slack_thread_root_ts: npsResponseRepliesTable.slack_thread_root_ts,
      })
      .from(npsResponseRepliesTable)
      .innerJoin(
        npsResponseTable,
        eq(npsResponseTable.id, npsResponseRepliesTable.nps_response_id),
      )
      .where(
        and(
          eq(npsResponseTable.user_id, author.id),
          eq(npsResponseRepliesTable.is_inbound, false),
          eq(npsResponseRepliesTable.slack_channel_id, msg.channel),
          isNotNull(npsResponseRepliesTable.slack_message_ts),
        ),
      )
      .orderBy(desc(npsResponseRepliesTable.created_at))
      .limit(1);
    if (latest) {
      npsResponseId = latest.nps_response_id;
      threadRootTs = latest.slack_thread_root_ts ?? latest.slack_message_ts ?? null;
    }
  }

  if (npsResponseId == null) return false;

  const [existing] = await db
    .select({ id: npsResponseRepliesTable.id })
    .from(npsResponseRepliesTable)
    .where(eq(npsResponseRepliesTable.slack_message_ts, msg.ts))
    .limit(1);
  if (existing) return true;

  await db.insert(npsResponseRepliesTable).values({
    nps_response_id: npsResponseId,
    responder_user_id: author.id,
    is_inbound: true,
    body: msg.text,
    slack_message_ts: msg.ts,
    slack_channel_id: msg.channel,
    slack_thread_root_ts: threadRootTs,
  });
  return true;
}

// Slack keeps the original ts under event.message, so the row is found by slack_ts.
async function handleMessageChanged(msg: SlackMessageEvent): Promise<void> {
  const newMsg = msg.message;
  if (!newMsg?.ts) return;
  const newText = (newMsg.text ?? "").trim();
  if (!newText) return;

  const [row] = await db
    .select({
      id: supportTicketMessageTable.id,
      ticket_id: supportTicketMessageTable.ticket_id,
      body: supportTicketMessageTable.body,
      original_body: supportTicketMessageTable.original_body,
    })
    .from(supportTicketMessageTable)
    .where(eq(supportTicketMessageTable.slack_ts, newMsg.ts))
    .limit(1);
  if (!row) return;
  if (row.body === newText) return;

  await db
    .update(supportTicketMessageTable)
    .set({
      body: newText,
      edited_at: new Date(),
      original_body: row.original_body ?? row.body,
    })
    .where(eq(supportTicketMessageTable.id, row.id));

  void publishMessageEdited(row.ticket_id, row.id);
}

// Soft delete keeps the body so reviewers can still see what was said.
async function handleMessageDeleted(msg: SlackMessageEvent): Promise<void> {
  const ts = msg.deleted_ts ?? msg.previous_message?.ts;
  if (!ts) return;

  const [row] = await db
    .select({
      id: supportTicketMessageTable.id,
      ticket_id: supportTicketMessageTable.ticket_id,
    })
    .from(supportTicketMessageTable)
    .where(eq(supportTicketMessageTable.slack_ts, ts))
    .limit(1);
  if (!row) return;

  await db
    .update(supportTicketMessageTable)
    .set({ deleted_at: new Date() })
    .where(eq(supportTicketMessageTable.id, row.id));

  void publishMessageDeleted(row.ticket_id, row.id);
}
