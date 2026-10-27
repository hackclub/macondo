// The backfill catches help-channel posts the events webhook missed (downtime, transient errors).

import { and, eq, inArray } from "drizzle-orm";

import db from "../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../db/schema";
import { writeAudit } from "./audit";
import { fetchSlackProfile } from "./slack";
import { isFreshSlackTs } from "./support-backfill-freshness";
import {
  recallBackfillSkip,
  rememberBackfillSkip,
} from "./support-backfill-negative-cache";
import {
  conversationsHistory,
  conversationsReplies,
  type SlackFile,
  type SlackHistoryMessage,
} from "./slack-bot";
import { buildMirroredSlackReplyValues } from "./support-ticket-mirror";
import {
  ackInPublicThread,
  postBtsMessage,
  publicSupportChannel,
} from "./support-ticket-slack";
import { useRuntimeConfig } from "#imports";

// undefined is a plain message, file_share carries an attachment, thread_broadcast counts as the reply
const ALLOWED_MESSAGE_SUBTYPES = new Set<string | undefined>([
  undefined,
  "file_share",
  "thread_broadcast",
]);

export function isMessageSubtypeAllowed(subtype: string | undefined): boolean {
  return ALLOWED_MESSAGE_SUBTYPES.has(subtype);
}

export function attachmentsFromSlackFiles(files: SlackFile[] | undefined): {
  url: string;
  filename: string;
  size_bytes: number | null;
  mime_type: string | null;
}[] {
  if (!files || files.length === 0) return [];
  const out: {
    url: string;
    filename: string;
    size_bytes: number | null;
    mime_type: string | null;
  }[] = [];
  for (const file of files) {
    // the public permalink needs no auth; the private URLs need the bot token
    const url = file?.permalink_public || file?.permalink || file?.url_private || file?.url_private_download;
    const filename = file?.name || file?.title || file?.id || "attachment";
    if (!url) continue;
    out.push({
      url,
      filename,
      size_bytes: typeof file.size === "number" ? file.size : null,
      mime_type: file.mimetype ?? null,
    });
  }
  return out;
}

type SlackAuthor = {
  user_id: string | null;
  name: string | null;
  avatar: string | null;
};

async function resolveSlackAuthor(slackUserId: string): Promise<SlackAuthor> {
  const [row] = await db
    .select({ id: users.id, name: users.name, image: users.image })
    .from(users)
    .where(eq(users.slack_id, slackUserId))
    .limit(1);
  if (row) {
    return { user_id: row.id, name: row.name, avatar: row.image };
  }
  const profile = await fetchSlackProfile(slackUserId);
  return { user_id: null, name: profile.username, avatar: profile.image };
}

// Idempotent: safe to call from both the live events webhook and the startup backfill.
export async function ensureTicketForSlackMessage(args: {
  channel: string;
  ts: string;
  text: string;
  user: string;
  files?: SlackFile[];
}): Promise<{ ticket_id: number | null; created: boolean; reason?: string }> {
  const [existing] = await db
    .select({ id: supportTicketTable.id })
    .from(supportTicketTable)
    .where(
      and(
        eq(supportTicketTable.slack_channel_id, args.channel),
        eq(supportTicketTable.slack_thread_ts, args.ts),
      ),
    )
    .limit(1);
  if (existing) {
    return { ticket_id: existing.id, created: false, reason: "ticket exists" };
  }

  const author = await resolveSlackAuthor(args.user);
  if (!author.user_id) {
    // a Slack user with no Macondo account can't own a ticket
    return { ticket_id: null, created: false, reason: "unknown slack user" };
  }

  const subject = (args.text.split("\n")[0] ?? args.text).slice(0, 80).trim() || "Support request"; // cap subject length

  const config = useRuntimeConfig();

  const [ticket] = await db
    .insert(supportTicketTable)
    .values({
      user_id: author.user_id,
      subject,
      body: args.text,
      category: "other",
      priority: "normal",
      status: "open",
      slack_channel_id: args.channel,
      slack_thread_ts: args.ts,
      bts_channel_id: (config.slackSupportBtsChannelId as string | undefined) ?? null,
    })
    .returning();
  if (!ticket) return { ticket_id: null, created: false, reason: "insert returned no row" };

  const [rootMsgRow] = await db
    .insert(supportTicketMessageTable)
    .values({
      ticket_id: ticket.id,
      author_user_id: author.user_id,
      body: args.text,
      is_internal_note: false,
      slack_ts: args.ts,
    })
    .returning({ id: supportTicketMessageTable.id });

  if (rootMsgRow) {
    const rootAttachments = attachmentsFromSlackFiles(args.files);
    if (rootAttachments.length > 0) {
      await db.insert(supportTicketAttachmentTable).values(
        rootAttachments.map((a) => ({ ...a, message_id: rootMsgRow.id })),
      );
    }
  }

  // replies can predate the ticket (missed root event, or backfill catch-up);
  // keyed by slack_ts so a later live event for the same reply lands on its own row
  try {
    const repliesRes = await conversationsReplies({
      channel: args.channel,
      ts: args.ts,
      limit: 200,
    });
    if (repliesRes.ok) {
      const authorCache = new Map<string, SlackAuthor>();
      authorCache.set(args.user, author);
      // skip the root and bot messages (our own ack); file-only replies still count
      for (const reply of repliesRes.messages.filter(
        (m) => m.ts !== args.ts && !m.bot_id && m.user && (m.text || (m.files && m.files.length > 0)),
      )) {
        let replyAuthor = authorCache.get(reply.user!);
        if (!replyAuthor) {
          replyAuthor = await resolveSlackAuthor(reply.user!);
          authorCache.set(reply.user!, replyAuthor);
        }
        // unlinked community members are mirrored, not skipped, so the thread matches Slack
        const [insertedReply] = await db
          .insert(supportTicketMessageTable)
          .values(
            buildMirroredSlackReplyValues({
              ticketId: ticket.id,
              slackUserId: reply.user!,
              author: replyAuthor,
              body: reply.text ?? "",
              slackTs: reply.ts ?? null,
            }),
          )
          .returning({ id: supportTicketMessageTable.id });
        if (insertedReply) {
          const replyAttachments = attachmentsFromSlackFiles(reply.files);
          if (replyAttachments.length > 0) {
            await db.insert(supportTicketAttachmentTable).values(
              replyAttachments.map((a) => ({ ...a, message_id: insertedReply.id })),
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[support-ticket] thread reply backfill failed", err);
  }

  try {
    await writeAudit({
      actor_id: author.user_id,
      action: "support_ticket.created_from_slack",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: null,
      new_value: {
        subject,
        slack_channel_id: args.channel,
        slack_thread_ts: args.ts,
      },
      sensitive: false,
      public_message: `Ticket #${ticket.id} created from Slack message`,
      change_summary: subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit slack create failed", err);
  }

  await ackInPublicThread({
    channel: args.channel,
    thread_ts: args.ts,
    ticket_id: ticket.id,
  });

  const btsRes = await postBtsMessage({
    id: ticket.id,
    subject,
    body: args.text,
    status: "open",
    priority: "normal",
    category: "other",
    author_display_name: author.name,
    author_avatar_url: author.avatar,
    slack_channel_id: args.channel,
    slack_thread_ts: args.ts,
  });

  if (btsRes.ts) {
    await db
      .update(supportTicketTable)
      .set({ bts_message_ts: btsRes.ts, updated_at: new Date() })
      .where(eq(supportTicketTable.id, ticket.id));
  }

  // lazy import keeps crossws out of the backfill startup path
  void import("./support-ticket-realtime").then((m) =>
    m.publishQueueChanged(ticket.id, author.user_id!, "ticket_created_from_slack"),
  ).catch(() => {});

  // Links only, no runSupportKbAnswerForNewTicket: a wrong generated answer in public costs far more.
  // Fresh threads only, since the boot backfill rescans days-old messages.
  if (isFreshSlackTs(args.ts)) {
    void import("./support-ticket-embedding")
      .then((m) => m.runCapybaraForNewTicket(ticket.id))
      .catch((err) => {
        console.error("[support-ticket] capybara from slack failed", ticket.id, err);
      });
  }

  return { ticket_id: ticket.id, created: true };
}

function isCandidateMessage(msg: SlackHistoryMessage): boolean {
  // Slack echoes thread_ts === ts on a top-level message; attachment-only posts still count
  if (!msg.user || !msg.ts) return false;
  if (!msg.text && !(msg.files && msg.files.length > 0)) return false;
  if (msg.bot_id) return false;
  if (!isMessageSubtypeAllowed(msg.subtype)) return false;
  if (msg.thread_ts && msg.thread_ts !== msg.ts) return false;
  return true;
}

async function botRepliedAlready(
  channel: string,
  ts: string,
): Promise<boolean> {
  // conversations.history has reply_count but not who replied, so fetch the thread
  const replies = await conversationsReplies({ channel, ts, limit: 50 });
  if (!replies.ok) return false;
  return replies.messages.slice(1).some((m) => !!m.bot_id);
}

// Bounded by `limit` so a long startup scan can't hang the boot; 100 messages ≈ a few days.
export async function backfillHelpChannelTickets(opts?: {
  limit?: number;
  // Only consider messages newer than this Slack ts (e.g. "1700000000.000").
  oldest?: string;
}): Promise<{
  scanned: number;
  created: number;
  skipped_existing: number;
  skipped_unknown_user: number;
  skipped_bot_already_replied: number;
  errors: number;
}> {
  const out = {
    scanned: 0,
    created: 0,
    skipped_existing: 0,
    skipped_unknown_user: 0,
    skipped_bot_already_replied: 0,
    errors: 0,
  };

  const channel = publicSupportChannel();
  if (!channel) {
    console.warn("[support-backfill] no public help channel configured; skipping");
    return out;
  }

  const history = await conversationsHistory({
    channel,
    limit: opts?.limit ?? 100,
    oldest: opts?.oldest,
  });
  if (!history.ok) {
    console.warn("[support-backfill] conversations.history failed", history.error);
    out.errors += 1;
    return out;
  }

  const candidates = history.messages.filter(isCandidateMessage);

  // one query per page: nearly every candidate already has a row, keeping Slack API usage near zero
  const existingTs = new Set<string>();
  if (candidates.length > 0) {
    const existingRows = await db
      .select({ ts: supportTicketTable.slack_thread_ts })
      .from(supportTicketTable)
      .where(
        and(
          eq(supportTicketTable.slack_channel_id, channel),
          inArray(
            supportTicketTable.slack_thread_ts,
            candidates.map((m) => m.ts),
          ),
        ),
      );
    for (const row of existingRows) {
      if (row.ts) existingTs.add(row.ts);
    }
  }

  for (const msg of candidates) {
    out.scanned += 1;

    if (existingTs.has(msg.ts)) {
      out.skipped_existing += 1;
      continue;
    }

    const remembered = recallBackfillSkip(channel, msg.ts);
    if (remembered === "unknown_user") {
      out.skipped_unknown_user += 1;
      continue;
    }
    if (remembered === "bot_already_replied") {
      out.skipped_bot_already_replied += 1;
      continue;
    }

    try {
      // the bot ack already landed, so there's nothing to do even if the ticket row was wiped
      if (await botRepliedAlready(channel, msg.ts)) {
        rememberBackfillSkip(channel, msg.ts, "bot_already_replied");
        out.skipped_bot_already_replied += 1;
        continue;
      }

      const result = await ensureTicketForSlackMessage({
        channel,
        ts: msg.ts,
        text: msg.text ?? "",
        user: msg.user!,
        files: msg.files,
      });

      if (result.created) {
        out.created += 1;
      } else if (result.reason === "unknown slack user") {
        rememberBackfillSkip(channel, msg.ts, "unknown_user");
        out.skipped_unknown_user += 1;
      } else {
        out.skipped_existing += 1;
      }
    } catch (err) {
      out.errors += 1;
      console.error(
        "[support-backfill] failed to backfill message",
        { ts: msg.ts, channel },
        err,
      );
    }
  }

  return out;
}
