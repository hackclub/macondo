// Redis-backed so presence survives tabs landing on different replicas. Stale
// tabs are pruned on join/leave; heartbeats only refresh score and TTL.

import { getRedis } from "./redis";
import { publishEvent } from "./realtime";

const TAB_TTL_SECONDS = 60;
const STALE_AFTER_MS = 30_000;

export type ViewerInfo = {
  userId: string;
  name: string;
  image: string | null;
};

type TabRecord = ViewerInfo & { ticketId: number };

function tabKey(tabId: string): string {
  return `presence:tab:${tabId}`;
}

function ticketKey(ticketId: number): string {
  return `presence:ticket:${ticketId}:tabs`;
}

export function presenceTopic(ticketId: number): string {
  return `presence:ticket:${ticketId}`;
}

async function readTab(tabId: string): Promise<TabRecord | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(tabKey(tabId));
    if (!raw) return null;
    return JSON.parse(raw) as TabRecord;
  } catch {
    return null;
  }
}

async function listActiveTabs(ticketId: number): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const cutoff = Date.now() - STALE_AFTER_MS;
  try {
    await redis.zRemRangeByScore(ticketKey(ticketId), 0, cutoff);
    const tabs = await redis.zRangeByScore(ticketKey(ticketId), cutoff, "+inf");
    return tabs ?? [];
  } catch (err) {
    console.warn("[presence] listActiveTabs failed", err);
    return [];
  }
}

async function snapshotViewers(ticketId: number): Promise<ViewerInfo[]> {
  const tabs = await listActiveTabs(ticketId);
  if (tabs.length === 0) return [];
  // One entry per user, sorted by name so the avatar stack is deterministic.
  const byUser = new Map<string, ViewerInfo>();
  for (const r of await Promise.all(tabs.map(readTab))) {
    if (!r) continue;
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, { userId: r.userId, name: r.name, image: r.image });
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function publishSnapshot(ticketId: number): Promise<void> {
  await publishEvent(presenceTopic(ticketId), {
    type: "viewing",
    ticketId,
    viewers: await snapshotViewers(ticketId),
  });
}

export async function joinViewer(
  ticketId: number,
  tabId: string,
  info: ViewerInfo,
): Promise<ViewerInfo[]> {
  const redis = await getRedis();
  if (!redis) return [info];
  const now = Date.now();
  try {
    await redis.set(tabKey(tabId), JSON.stringify({ ...info, ticketId } satisfies TabRecord), {
      EX: TAB_TTL_SECONDS,
    });
    await redis.zAdd(ticketKey(ticketId), { score: now, value: tabId });
  } catch (err) {
    console.warn("[presence] joinViewer failed", err);
  }
  await publishSnapshot(ticketId);
  return snapshotViewers(ticketId);
}

export async function heartbeatViewer(
  ticketId: number,
  tabId: string,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const now = Date.now();
  try {
    await redis.expire(tabKey(tabId), TAB_TTL_SECONDS);
    await redis.zAdd(ticketKey(ticketId), { score: now, value: tabId });
  } catch (err) {
    console.warn("[presence] heartbeat failed", err);
  }
}

export async function leaveViewer(
  ticketId: number,
  tabId: string,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(tabKey(tabId));
    await redis.zRem(ticketKey(ticketId), tabId);
  } catch (err) {
    console.warn("[presence] leave failed", err);
  }
  await publishSnapshot(ticketId);
}

// Pass-through; client timers clear stale typing indicators.
export async function publishTyping(
  ticketId: number,
  userId: string,
  state: "start" | "stop",
): Promise<void> {
  await publishEvent(presenceTopic(ticketId), {
    type: "typing",
    ticketId,
    userId,
    state,
  });
}
