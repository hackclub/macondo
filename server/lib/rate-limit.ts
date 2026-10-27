import { getRedis } from "./redis";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Fixed-window limiter; fails open when Redis is unavailable. */
export async function checkRateLimit(
  userId: number | string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = await getRedis();
  if (!redis) return { allowed: true };

  const key = `rl:${bucket}:${userId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    if (count > limit) {
      const ttl = await redis.ttl(key);
      return {
        allowed: false,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Each [limit, windowSeconds] window keeps its own counter; the first to trip wins. */
export async function checkRateLimits(
  id: number | string,
  bucket: string,
  windows: Array<[limit: number, windowSeconds: number]>,
): Promise<RateLimitResult> {
  for (const [limit, windowSeconds] of windows) {
    const result = await checkRateLimit(
      id,
      `${bucket}:${windowSeconds}s`,
      limit,
      windowSeconds,
    );
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
