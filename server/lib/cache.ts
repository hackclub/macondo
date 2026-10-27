import { getRedis } from "./redis";

type CacheEntry<T> = { data: T; freshUntil: number };

const inflight = new Map<string, Promise<unknown>>();

// Stale-while-revalidate; runs the producer directly when Redis is unavailable.
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options?: { staleSeconds?: number },
): Promise<T> {
  const redis = await getRedis();
  if (!redis) return producer();

  const now = Date.now();
  const totalTtl = ttlSeconds + (options?.staleSeconds ?? ttlSeconds * 4); // stale window defaults to 4x the ttl

  let entry: CacheEntry<T> | null = null;
  try {
    const raw = await redis.get(key);
    if (raw) entry = JSON.parse(raw) as CacheEntry<T>;
  } catch {
    entry = null;
  }

  if (entry) {
    if (entry.freshUntil > now) return entry.data;
    if (!inflight.has(key)) {
      const refresh = (async () => {
        try {
          const next: CacheEntry<T> = {
            data: await producer(),
            freshUntil: Date.now() + ttlSeconds * 1000,
          };
          await redis.set(key, JSON.stringify(next), { EX: totalTtl });
        } catch {
          // stale data is still being served
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, refresh);
    }
    return entry.data;
  }

  // Coalesce concurrent producers on the same key.
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const work = (async () => {
    try {
      const fresh = await producer();
      const next: CacheEntry<T> = {
        data: fresh,
        freshUntil: Date.now() + ttlSeconds * 1000,
      };
      try {
        await redis.set(key, JSON.stringify(next), { EX: totalTtl });
      } catch {
        // still return fresh data on write failure
      }
      return fresh;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, work);
  return work;
}

export async function invalidate(...keys: string[]) {
  if (keys.length === 0) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(keys);
  } catch {
    // best-effort
  }
}

export async function invalidatePattern(pattern: string) {
  const redis = await getRedis();
  if (!redis) return;
  try {
    const keys: string[] = [];
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(key)) keys.push(...key);
      else keys.push(key);
    }
    if (keys.length > 0) await redis.del(keys);
  } catch {
    // best-effort
  }
}

export function projectCacheKeys(projectId: number | string) {
  const id = String(projectId);
  return {
    // Bump the version when the cached shape changes so old entries aren't read.
    base: `project:base:v2:${id}`,
    journalsOwner: `project:journals:${id}:owner`,
    journalsPublic: `project:journals:${id}:public`,
    ships: `project:ships:${id}`,
    hackatimeBreakdown: `project:hackatime-breakdown:v2:${id}`,
  };
}

export async function invalidateProject(projectId: number | string) {
  const k = projectCacheKeys(projectId);
  await invalidate(k.base, k.journalsOwner, k.journalsPublic, k.ships, k.hackatimeBreakdown);
}
