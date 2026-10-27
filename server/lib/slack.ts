import { getRedis } from "./redis";
import { CACHET_URL, SLACK_API_URL } from "./api-urls";

const CACHE_TTL = 60 * 60;

interface CachetUserResponse {
  type: string;
  id: string;
  userId: string;
  displayName: string;
  pronouns: string;
  imageUrl: string;
  expiration: string;
}

interface SlackUserData {
  username: string | null;
  image: string | null;
}

interface SlackUsersInfoResponse {
  ok: boolean;
  user?: {
    name?: string;
    profile?: { display_name?: string };
  };
  error?: string;
}

// Prefers display_name, falls back to the @-handle; never real_name, so it's safe to show publicly.
export async function fetchSlackHandle(
  slackId: string,
): Promise<string | null> {
  const cacheKey = `slack:handle:${slackId}`;
  const redis = await getRedis();
  const cached = await redis?.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached || null;
  }

  const token = process.env.NUXT_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await $fetch<SlackUsersInfoResponse>(
      `${SLACK_API_URL}/users.info?user=${encodeURIComponent(slackId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res?.ok) return null;
    const fallback = res.user?.name?.trim();
    const handle = res.user?.profile?.display_name?.trim() || fallback || null;
    if (redis) await redis.set(cacheKey, handle ?? "", { EX: CACHE_TTL });
    return handle;
  } catch (err) {
    console.error("[slack] users.info failed:", err);
    return null;
  }
}

export async function fetchSlackProfile(
  slackId: string,
): Promise<SlackUserData> {

  const cacheKey = `slack:user:${slackId}`;

  const redis = await getRedis();
  const cached = await redis?.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as SlackUserData;
    } catch { /* corrupted cache, re-fetch */ }
  }

  try {
    const res = await $fetch<CachetUserResponse>(
      `${CACHET_URL}/users/${slackId}`,
    );

    if (!res?.userId) {
      console.warn("[slack] cachet user lookup returned no user");
      return { username: null, image: null };
    }

    const data: SlackUserData = { username: res.displayName || null, image: res.imageUrl || null };

    if (redis) await redis.set(cacheKey, JSON.stringify(data), { EX: CACHE_TTL });

    return data;
  } catch (err) {
    console.error("[slack] Error fetching Cachet profile:", err);
    return { username: null, image: null };
  }
}
