import crypto from "node:crypto";
import { useRuntimeConfig } from "#imports";
import { SLACK_API_URL } from "./api-urls";

type SlackApiResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function token(): string | undefined {
  const config = useRuntimeConfig();
  const t = config.slackBotToken as string | undefined;
  return t && t.length > 0 ? t : undefined;
}

function userToken(): string | undefined {
  const config = useRuntimeConfig();
  const t = config.slackUserToken as string | undefined;
  return t && t.length > 0 ? t : undefined;
}

async function call<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
  opts?: { token?: string },
): Promise<SlackApiResult<T>> {
  const auth = opts?.token ?? token();
  if (!auth) return { ok: false, error: "no slack token configured" };

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

export async function postMessage(args: {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  username?: string;
  icon_url?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}): Promise<SlackApiResult<{ ts: string; channel: string }>> {
  return call<{ ts: string; channel: string }>("chat.postMessage", {
    unfurl_links: true,
    unfurl_media: true,
    ...args,
  });
}

// Incoming webhooks reply with plain text ("ok" or an error slug), not JSON, so normalize it.
export async function postWebhook(
  url: string,
  payload: {
    text?: string;
    blocks?: SlackBlock[];
    username?: string;
    icon_url?: string;
    unfurl_links?: boolean;
    unfurl_media?: boolean;
  },
): Promise<SlackApiResult> {
  if (!url) return { ok: false, error: "no slack webhook url configured" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const body = (await res.text()).trim();
    if (res.ok && body.toLowerCase() === "ok") return { ok: true };
    return { ok: false, error: body || `http ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateMessage(args: {
  channel: string;
  ts: string;
  text?: string;
  blocks?: SlackBlock[];
}): Promise<SlackApiResult> {
  return call("chat.update", args);
}

export async function openConversation(
  userId: string,
): Promise<SlackApiResult<{ channel: { id: string } }>> {
  return call<{ channel: { id: string } }>("conversations.open", { users: userId });
}

export async function dm(args: {
  user: string;
  text?: string;
  blocks?: SlackBlock[];
  username?: string;
  icon_url?: string;
  thread_ts?: string;
}): Promise<SlackApiResult<{ ts: string; channel: string }>> {
  const opened = await openConversation(args.user);
  if (!opened.ok) return opened;
  const channelId = opened.channel?.id;
  if (!channelId) return { ok: false, error: "conversations.open returned no channel id" };
  return postMessage({
    channel: channelId,
    text: args.text,
    blocks: args.blocks,
    username: args.username,
    icon_url: args.icon_url,
    thread_ts: args.thread_ts,
  });
}

export async function addReaction(args: {
  channel: string;
  timestamp: string;
  name: string;
}): Promise<SlackApiResult> {
  return call("reactions.add", args);
}

export async function removeReaction(args: {
  channel: string;
  timestamp: string;
  name: string;
}): Promise<SlackApiResult> {
  return call("reactions.remove", args);
}

// uncached; callers should cache the result
export async function conversationMembers(
  channel: string,
): Promise<SlackApiResult<{ members: string[] }>> {
  const bot = token();
  if (!bot) return { ok: false, error: "no slack bot token configured" };

  const members: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) { // cap at 20 pages of members
    const params = new URLSearchParams({ channel, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    try {
      const res = await fetch(`${SLACK_API_URL}/conversations.members?${params}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${bot}` },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        members?: string[];
        response_metadata?: { next_cursor?: string };
      };
      if (!json.ok) {
        return { ok: false, error: json.error ?? `http ${res.status}` };
      }
      members.push(...(json.members ?? []));
      const next = json.response_metadata?.next_cursor;
      if (!next) break;
      cursor = next;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true, members } as SlackApiResult<{ members: string[] }>;
}

// Max 1000 users per call. asUser uses the admin user token because bots can't invite guests;
// returns no_user_token when it isn't configured so the caller can fall back.
export async function inviteToConversation(args: {
  channel: string;
  users: string[];
  asUser?: boolean;
}): Promise<
  SlackApiResult<{
    channel?: { id: string };
    errors?: { user: string; error: string }[];
  }>
> {
  let tokenOverride: string | undefined;
  if (args.asUser) {
    tokenOverride = userToken();
    if (!tokenOverride) return { ok: false, error: "no_user_token" };
  }
  return call<{
    channel?: { id: string };
    errors?: { user: string; error: string }[];
  }>(
    "conversations.invite",
    {
      channel: args.channel,
      users: args.users.join(","),
    },
    tokenOverride ? { token: tokenOverride } : undefined,
  );
}

// asUser: many workspaces restrict kicks to admins (same fallback as inviteToConversation)
export async function kickFromConversation(args: {
  channel: string;
  user: string;
  asUser?: boolean;
}): Promise<SlackApiResult> {
  let tokenOverride: string | undefined;
  if (args.asUser) {
    tokenOverride = userToken();
    if (!tokenOverride) return { ok: false, error: "no_user_token" };
  }
  return call(
    "conversations.kick",
    { channel: args.channel, user: args.user },
    tokenOverride ? { token: tokenOverride } : undefined,
  );
}

export type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
  permalink_public?: string;
  thumb_360?: string;
};

export type SlackHistoryMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  reply_count?: number;
  reply_users_count?: number;
  reply_users?: string[];
  files?: SlackFile[];
};

export async function conversationsHistory(args: {
  channel: string;
  limit?: number;
  oldest?: string;
}): Promise<SlackApiResult<{ messages: SlackHistoryMessage[] }>> {
  const bot = token();
  if (!bot) return { ok: false, error: "no slack bot token configured" };

  const params = new URLSearchParams({
    channel: args.channel,
    limit: String(args.limit ?? 100),
  });
  if (args.oldest) params.set("oldest", args.oldest);

  try {
    const res = await fetch(`${SLACK_API_URL}/conversations.history?${params}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bot}` },
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.ok === true) {
      return {
        ok: true,
        messages: (json.messages as SlackHistoryMessage[]) ?? [],
      } as SlackApiResult<{ messages: SlackHistoryMessage[] }>;
    }
    return { ok: false, error: typeof json.error === "string" ? json.error : `http ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function conversationsReplies(args: {
  channel: string;
  ts: string;
  limit?: number;
}): Promise<SlackApiResult<{ messages: SlackHistoryMessage[] }>> {
  const bot = token();
  if (!bot) return { ok: false, error: "no slack bot token configured" };

  const params = new URLSearchParams({
    channel: args.channel,
    ts: args.ts,
    limit: String(args.limit ?? 100),
  });

  try {
    const res = await fetch(`${SLACK_API_URL}/conversations.replies?${params}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bot}` },
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.ok === true) {
      return {
        ok: true,
        messages: (json.messages as SlackHistoryMessage[]) ?? [],
      } as SlackApiResult<{ messages: SlackHistoryMessage[] }>;
    }
    return { ok: false, error: typeof json.error === "string" ? json.error : `http ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function verifySignature(args: {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
}): boolean {
  const config = useRuntimeConfig();
  const secret = config.slackSigningSecret as string | undefined;
  if (!secret) return false;
  if (!args.signature || !args.timestamp) return false;

  // reject stale requests to prevent replay attacks
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(`v0:${args.timestamp}:${args.rawBody}`)
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(args.signature),
    );
  } catch {
    return false;
  }
}
