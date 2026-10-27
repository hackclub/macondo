import { randomUUID } from "node:crypto";

import { getRedis } from "./redis";

// Lock fails closed without Redis, since nothing else stops two replicas double-firing a heavy job.
// Status writes are best-effort so a status hiccup never masks a successful run.

const LOCK_PREFIX = "admin-job:lock:";
const STATUS_PREFIX = "admin-job:last:";

const heldLocks = new Set<string>();

export type JobStatusPayload = {
  ok: boolean;
  ranAt: string;
  durationMs: number;
  report?: unknown;
  error?: string;
};

export type LockResult =
  | { ok: true; token: string; release: () => Promise<void> }
  | { ok: false; reason: "already_running" | "redis_unavailable" };

export async function tryAcquireLock(
  lockName: string,
  leaseSeconds: number = 60, // default lock lease in seconds
): Promise<LockResult> {
  if (heldLocks.has(lockName)) {
    return { ok: false, reason: "already_running" };
  }

  const redis = await getRedis();
  if (!redis) {
    return { ok: false, reason: "redis_unavailable" };
  }

  const key = LOCK_PREFIX + lockName;
  const token = randomUUID();
  let acquired: string | null = null;
  try {
    acquired = await redis.set(key, token, { EX: leaseSeconds, NX: true });
  } catch (err) {
    console.error(`[admin-job] redis SET failed for ${lockName}`, err);
    return { ok: false, reason: "redis_unavailable" };
  }
  if (acquired !== "OK") {
    return { ok: false, reason: "already_running" };
  }
  heldLocks.add(lockName);

  // Re-EXPIRE so a job outliving the lease keeps it; unref() so shutdown isn't blocked.
  const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
    void (async () => {
      try {
        if ((await redis.get(key)) !== token) {
          clearInterval(heartbeat);
          heldLocks.delete(lockName);
          return;
        }
        await redis.expire(key, leaseSeconds);
      } catch {
        // ignore heartbeat errors; release/expiry will sort it out
      }
    })();
  }, Math.max(5_000, Math.floor((leaseSeconds * 1000) / 2))); // heartbeat at half the lease, 5s floor
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  let released = false;
  return {
    ok: true,
    token,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      heldLocks.delete(lockName);
      try {
        if ((await redis.get(key)) === token) {
          await redis.del(key);
        }
      } catch (err) {
        console.warn(`[admin-job] release failed for ${lockName}`, err);
      }
    },
  };
}

export async function writeJobStatus(
  statusName: string,
  payload: JobStatusPayload,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(STATUS_PREFIX + statusName, JSON.stringify(payload), {
      EX: 7 * 24 * 60 * 60, // status record ttl, 7 days
    });
  } catch (err) {
    console.warn(`[admin-job] writeJobStatus failed for ${statusName}`, err);
  }
}

// Runs on startup so locks left by a killed container don't block jobs for the full lease.
// SCAN instead of KEYS, which would block Redis under load. A job running on another replica
// can lose its lock when this replica boots; accepted since it only runs on boot.
export async function clearAllAdminJobLocks(): Promise<{ cleared: number; keys: string[] }> {
  const redis = await getRedis();
  if (!redis) return { cleared: 0, keys: [] };
  const pattern = LOCK_PREFIX + "*";
  const found: string[] = [];
  try {
    let cursor = "0";
    do {
      const reply = (await redis.scan(cursor, { MATCH: pattern, COUNT: 100 })) as
        | { cursor: string; keys: string[] }
        | [string, string[]];
      if (Array.isArray(reply)) {
        cursor = String(reply[0]);
        found.push(...reply[1]);
      } else {
        cursor = String(reply.cursor);
        found.push(...reply.keys);
      }
    } while (cursor !== "0");
    if (found.length === 0) return { cleared: 0, keys: [] };
    await redis.del(found);
    // only non-empty after a dev hot-reload
    heldLocks.clear();
    return { cleared: found.length, keys: found };
  } catch (err) {
    console.warn("[admin-job] clearAllAdminJobLocks failed", err);
    return { cleared: 0, keys: [] };
  }
}

export type JobStatusResponse = {
  running: boolean;
  last?: JobStatusPayload;
};

export async function getJobStatus(
  statusName: string,
  lockName: string,
): Promise<JobStatusResponse> {
  const redis = await getRedis();
  if (!redis) {
    return { running: heldLocks.has(lockName) };
  }
  let running = heldLocks.has(lockName);
  let last: JobStatusPayload | undefined;
  try {
    if ((await redis.exists(LOCK_PREFIX + lockName)) > 0) running = true;
  } catch (err) {
    console.warn(`[admin-job] EXISTS failed for ${lockName}`, err);
  }
  try {
    const raw = await redis.get(STATUS_PREFIX + statusName);
    if (raw) {
      last = JSON.parse(raw) as JobStatusPayload;
    }
  } catch (err) {
    console.warn(`[admin-job] status read failed for ${statusName}`, err);
  }
  return { running, last };
}
