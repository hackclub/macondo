// Postgres is the source of truth and Slack only a mirror, so everything no-ops without Slack config.

import { useRuntimeConfig } from "#imports";

import { getRedis } from "./redis";
import { addReaction, conversationMembers, postMessage, updateMessage, type SlackBlock } from "./slack-bot";

const RESOLVE_REACTION = "white_check_mark";

// so a scroll through #macondo-help shows which threads are handled
export async function reactResolvedOnOriginal(ticket: {
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
}): Promise<void> {
  if (!ticket.slack_channel_id || !ticket.slack_thread_ts) return;
  await addReaction({
    channel: ticket.slack_channel_id,
    timestamp: ticket.slack_thread_ts,
    name: RESOLVE_REACTION,
  });
}

export const TICKET_RESOLVE_REACTION = RESOLVE_REACTION;

async function supportTeamMemberIds(): Promise<Set<string> | null> {
  const config = useRuntimeConfig();
  const channel = config.slackSupportBtsChannelId as string | undefined;
  if (!channel) return null;

  const redis = await getRedis();
  const cacheKey = `slack:support_team_members:${channel}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return new Set(JSON.parse(cached) as string[]);
    } catch {
      /* ignore corrupted cache */
    }
  }

  const res = await conversationMembers(channel);
  if (!res.ok) {
    console.warn("[support-ticket] conversations.members failed", res.error);
    return null;
  }
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(res.members), {
        EX: 5 * 60, // 5 min; avoids Slack rate limits per resolve
      });
    } catch {
      /* ignore write errors */
    }
  }
  return new Set(res.members);
}

export async function isSupportTeamSlackMember(
  slackId: string | null | undefined,
): Promise<boolean> {
  if (!slackId) return false;
  const members = await supportTeamMemberIds();
  return !!members && members.has(slackId);
}

// canonical resolve ACL for every resolve entry point
export async function canResolveSupportTicket(
  actor: { id: string; slack_id: string | null | undefined } | null | undefined,
  ticket: { user_id: string },
): Promise<boolean> {
  if (!actor) return false;
  if (actor.id === ticket.user_id) return true;
  return isSupportTeamSlackMember(actor.slack_id);
}

type TicketSnapshot = {
  id: number;
  subject: string;
  body: string;
  status: "open" | "claimed" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  category: string;
  claimed_by_name?: string | null;
  resolved_by_name?: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
  // optional: tickets filed via the in-app widget have no public Slack thread
  slack_channel_id?: string | null;
  slack_thread_ts?: string | null;
};

export function slackThreadUrl(channelId: string | null | undefined, ts: string | null | undefined): string | null {
  if (!channelId || !ts) return null;
  return `https://hackclub.enterprise.slack.com/archives/${channelId}/p${ts.replace(".", "")}`;
}

function statusEmoji(status: TicketSnapshot["status"]): string {
  switch (status) {
    case "open":
      return ":large_yellow_circle:";
    case "claimed":
      return ":large_blue_circle:";
    case "resolved":
      return ":white_check_mark:";
    case "closed":
      return ":no_entry_sign:";
  }
}

function priorityEmoji(priority: TicketSnapshot["priority"]): string {
  switch (priority) {
    case "urgent":
      return ":rotating_light:";
    case "high":
      return ":warning:";
    case "normal":
      return "";
    case "low":
      return ":arrow_down_small:";
  }
}

function statusHeadline(ticket: TicketSnapshot): string {
  const emoji = statusEmoji(ticket.status);
  if (ticket.status === "claimed" && ticket.claimed_by_name) {
    return `${emoji} Claimed by ${ticket.claimed_by_name}`;
  }
  if (ticket.status === "resolved" && ticket.resolved_by_name) {
    return `${emoji} Resolved by ${ticket.resolved_by_name}`;
  }
  if (ticket.status === "resolved") return `${emoji} Resolved`;
  if (ticket.status === "closed") return `${emoji} Closed`;
  return `${emoji} Not claimed`;
}

export function btsBlocks(ticket: TicketSnapshot): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const base = (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: statusHeadline(ticket).slice(0, 150), // slack header text max length
      emoji: true,
    },
  });

  if (ticket.status === "open" || ticket.status === "claimed") {
    const actionElements: Record<string, unknown>[] = [];
    if (ticket.status === "open") {
      actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "Claim", emoji: true },
        action_id: "support_claim",
        value: String(ticket.id),
      });
    }
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "Mark Resolved", emoji: true },
      style: "primary",
      action_id: "support_resolve",
      value: String(ticket.id),
    });
    blocks.push({ type: "actions", elements: actionElements });
  }

  const priority = priorityEmoji(ticket.priority);
  const meta = [
    `*${ticket.author_display_name ?? "Unknown"}*`,
    ticket.category,
    priority ? `${priority} ${ticket.priority}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${ticket.subject.slice(0, 150)}*\n${meta}`,
    },
  });

  const quoted = ticket.body
    .slice(0, 1500) // cap quoted body length
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: quoted },
  });

  // shown regardless of status: staff jump back even after resolve
  const navElements: Record<string, unknown>[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "View in Macondo", emoji: true },
      url: `${base}/internal/support/${ticket.id}`,
    },
  ];
  const slackThread = slackThreadUrl(ticket.slack_channel_id, ticket.slack_thread_ts);
  if (slackThread) {
    navElements.push({
      type: "button",
      text: { type: "plain_text", text: "View in Slack", emoji: true },
      url: slackThread,
    });
  }
  blocks.push({ type: "actions", elements: navElements });

  // no `#`: Slack mrkdwn renders `#1234` as a private-channel mention
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Ticket ${ticket.id}`,
      },
    ],
  });

  return blocks;
}

function btsChannel(): string | null {
  const config = useRuntimeConfig();
  const channel = config.slackSupportBtsChannelId as string | undefined;
  return channel && channel.length > 0 ? channel : null;
}

export function publicSupportChannel(): string | null {
  const config = useRuntimeConfig();
  const channel = config.slackSupportPublicChannelId as string | undefined;
  return channel && channel.length > 0 ? channel : null;
}

export async function ackInPublicThread(args: {
  channel: string;
  thread_ts: string;
  ticket_id: number;
}): Promise<void> {
  const ackText =
    ":blobhaj_party: Thank you for creating a ticket. Someone will help you soon. Make sure to read the FAQ pinned to this channel & on <https://macondo.hackclub.com/docs|macondo.hackclub.com/docs>!";
  await postMessage({
    channel: args.channel,
    thread_ts: args.thread_ts,
    text: ackText,
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: ackText },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Mark as resolved", emoji: true },
            style: "primary",
            action_id: "support_resolve",
            value: String(args.ticket_id),
          },
        ],
      },
    ],
  });
}

// unfurl flags pass through only when set: postMessage forces them on for staff screenshots
export async function postPublicThreadReply(args: {
  channel: string;
  thread_ts: string;
  text: string;
  username?: string;
  icon_url?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}): Promise<void> {
  await postMessage({
    channel: args.channel,
    thread_ts: args.thread_ts,
    text: args.text,
    username: args.username,
    icon_url: args.icon_url,
    ...(args.unfurl_links === undefined ? {} : { unfurl_links: args.unfurl_links }),
    ...(args.unfurl_media === undefined ? {} : { unfurl_media: args.unfurl_media }),
  });
}

export async function postBtsMessage(
  ticket: TicketSnapshot,
): Promise<{ ts?: string; error?: string }> {
  const channel = btsChannel();
  if (!channel) return { error: "no bts channel configured" };
  const res = await postMessage({
    channel,
    text: `New ticket: ${ticket.subject}`,
    blocks: btsBlocks(ticket),
  });
  if (!res.ok) return { error: res.error };
  return { ts: res.ts };
}

export async function updateBtsMessage(
  ticket: TicketSnapshot & { bts_message_ts: string | null },
): Promise<void> {
  const channel = btsChannel();
  if (!channel || !ticket.bts_message_ts) return;
  await updateMessage({
    channel,
    ts: ticket.bts_message_ts,
    text: `Ticket #${ticket.id}: ${ticket.subject}`,
    blocks: btsBlocks(ticket),
  });
}

export async function postBtsThreadReply(args: {
  bts_message_ts: string;
  text: string;
  username?: string;
  icon_url?: string;
}): Promise<void> {
  const channel = btsChannel();
  if (!channel) return;
  await postMessage({
    channel,
    thread_ts: args.bts_message_ts,
    text: args.text,
    username: args.username,
    icon_url: args.icon_url,
  });
}
