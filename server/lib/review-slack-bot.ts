// Kept separate from slack-bot.ts so the two bot tokens never cross-wire.

import { useRuntimeConfig } from "#imports";
import { SLACK_API_URL } from "./api-urls";

type SlackApiResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function token(): string | undefined {
  const config = useRuntimeConfig();
  const t = config.reviewSlackBotToken as string | undefined;
  return t && t.length > 0 ? t : undefined;
}

async function  call<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
): Promise<SlackApiResult<T>> {
  const auth = token();
  if (!auth) return { ok: false, error: "no review slack bot token configured" };

  try {
    const res = await fetch(`${SLACK_API_URL}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.ok === true) return { ok: true, ...json } as SlackApiResult<T>;
    return { ok: false, error: typeof json.error === "string" ? json.error : `http ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SlackBlock = Record<string, unknown>;

export async function postReviewMessage(args: {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}): Promise<SlackApiResult<{ ts: string; channel: string }>> {
  return call<{ ts: string; channel: string }>("chat.postMessage", {
    unfurl_links: false,
    unfurl_media: true,
    ...args,
  });
}

export async function openReviewConversation(
  userId: string,
): Promise<SlackApiResult<{ channel: { id: string } }>> {
  return call<{ channel: { id: string } }>("conversations.open", { users: userId });
}

// Needs channels:manage / groups:write and channel membership. Already-gone
// users return benign errors that callers should treat as success.
export async function kickFromReviewChannel(args: {
  channel: string;
  user: string;
}): Promise<SlackApiResult> {
  return call("conversations.kick", {
    channel: args.channel,
    user: args.user,
  });
}

export async function reviewDm(args: {
  user: string;
  text?: string;
  blocks?: SlackBlock[];
}): Promise<SlackApiResult<{ ts: string; channel: string }>> {
  const opened = await openReviewConversation(args.user);
  if (!opened.ok) return opened;
  const channelId = opened.channel?.id;
  if (!channelId) return { ok: false, error: "conversations.open returned no channel id" };
  return postReviewMessage({
    channel: channelId,
    text: args.text,
    blocks: args.blocks,
  });
}
