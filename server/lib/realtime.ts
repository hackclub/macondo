// Every replica (publisher included) fans Redis events out to its local peers;
// without Redis it fans out in-process. Internal notes only reach admin peers.

import type { Peer } from "crossws";
import { getRedis } from "./redis";

export type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

const REDIS_PREFIX = "rt:";

const localSubs = new Map<string, Set<Peer>>();

let subscriberStarted = false;
let subscriberReady = false;

async function ensureSubscriber(): Promise<void> {
  if (subscriberStarted) return;
  subscriberStarted = true;

  const main = await getRedis();
  if (!main) return;

  try {
    const sub = main.duplicate();
    sub.on("error", (err: unknown) => {
      console.warn(
        "[realtime] subscriber error",
        err instanceof Error ? err.message : err,
      );
    });
    await sub.connect();
    await sub.pSubscribe(`${REDIS_PREFIX}*`, (message: string, channel: string) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message) as RealtimeEvent;
      } catch {
        return;
      }
      fanoutLocal(channel.slice(REDIS_PREFIX.length), event);
    });
    subscriberReady = true;
  } catch (err) {
    console.warn("[realtime] subscriber init failed", err);
  }
}

type PeerContext = {
  isAdmin?: boolean;
  realtimeTopics?: Set<string>;
  [key: string]: unknown;
};

function getCtx(peer: Peer): PeerContext {
  return peer.context as PeerContext;
}

function fanoutLocal(topic: string, event: RealtimeEvent): void {
  const peers = localSubs.get(topic);
  if (!peers || peers.size === 0) return;

  const isInternalNote =
    event.type === "message_added" &&
    typeof event.message === "object" &&
    event.message !== null &&
    (event.message as { is_internal_note?: boolean }).is_internal_note === true;

  const payload = JSON.stringify({ topic, event });

  if (isInternalNote) {
    for (const peer of peers) {
      try {
        if (getCtx(peer).isAdmin !== true) continue;
        peer.send(payload);
      } catch (err) {
        console.warn("[realtime] peer.send failed", err);
      }
    }
    return;
  }

  for (const peer of peers) {
    try {
      peer.send(payload);
    } catch (err) {
      console.warn("[realtime] peer.send failed", err);
    }
  }
}

export async function publishEvent(
  topic: string,
  event: RealtimeEvent,
): Promise<void> {
  await ensureSubscriber();

  const redis = await getRedis();
  if (redis && subscriberReady) {
    try {
      await redis.publish(`${REDIS_PREFIX}${topic}`, JSON.stringify(event));
      return;
    } catch (err) {
      console.warn("[realtime] publish failed, falling back to local", err);
    }
  }

  fanoutLocal(topic, event);
}

export function subscribePeer(peer: Peer, topic: string): void {
  let set = localSubs.get(topic);
  if (!set) {
    set = new Set();
    localSubs.set(topic, set);
  }
  set.add(peer);

  const ctx = getCtx(peer);
  if (!ctx.realtimeTopics) ctx.realtimeTopics = new Set();
  ctx.realtimeTopics.add(topic);
}

export function unsubscribePeer(peer: Peer, topic: string): void {
  const set = localSubs.get(topic);
  if (set) {
    set.delete(peer);
    if (set.size === 0) localSubs.delete(topic);
  }
  getCtx(peer).realtimeTopics?.delete(topic);
}

export function unsubscribePeerAll(peer: Peer): void {
  const topics = getCtx(peer).realtimeTopics;
  if (!topics) return;
  for (const topic of topics) {
    const set = localSubs.get(topic);
    if (set) {
      set.delete(peer);
      if (set.size === 0) localSubs.delete(topic);
    }
  }
  topics.clear();
}

void ensureSubscriber();
