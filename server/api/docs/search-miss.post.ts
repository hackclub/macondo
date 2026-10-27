import db from "../../db";
import { docsSearchMissesTable } from "../../db/schema";
import { getSession } from "../../lib/session";
import { getRedis } from "../../lib/redis";

const DEDUPE_WINDOW_SECONDS = 30;

// Fallback when Redis is unreachable; every call site must work when getRedis() returns null.
const memoryDedupe = new Map<string, number>();

function pruneMemoryDedupe(now: number): void {
  const cutoff = now - DEDUPE_WINDOW_SECONDS * 1000;
  for (const [k, ts] of memoryDedupe) {
    if (ts < cutoff) memoryDedupe.delete(k);
  }
  // Hard cap in case Redis stays down under sustained traffic.
  if (memoryDedupe.size > 5000) {
    const oldest = [...memoryDedupe.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, memoryDedupe.size - 5000);
    for (const [k] of oldest) memoryDedupe.delete(k);
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ query?: unknown; locale?: unknown }>(event);
  const localeIn = typeof body?.locale === "string" ? body.locale : "";

  const normalized = (typeof body?.query === "string" ? body.query : "")
    .trim()
    .toLowerCase()
    .slice(0, 200); // max query length, prevents table bloat
  const locale: "en" | "es" = localeIn === "es" ? "es" : "en";

  if (normalized.length < 3) {
    return { recorded: false };
  }

  const userId = (await getSession(event).catch(() => null))?.id ?? null;

  // Falls back to IP so a first-time visitor without a cookie is still deduped.
  const visitorCookie = getCookie(event, "macondo_rv");
  const ipHeader =
    getHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ??
    getHeader(event, "x-real-ip") ??
    "anon";
  const visitorId = userId ?? visitorCookie ?? ipHeader ?? "anon";

  const key = `docs-miss:${visitorId}:${locale}:${normalized}`;

  const redis = await getRedis().catch(() => null);
  let isDuplicate = false;
  if (redis) {
    try {
      isDuplicate = (await redis.set(key, "1", {
        EX: DEDUPE_WINDOW_SECONDS,
        NX: true,
      })) === null;
    } catch {
      // Redis hiccup; treat as not a duplicate.
      isDuplicate = false;
    }
  }
  if (!redis) {
    const now = Date.now();
    pruneMemoryDedupe(now);
    const prev = memoryDedupe.get(key);
    if (prev && now - prev < DEDUPE_WINDOW_SECONDS * 1000) {
      isDuplicate = true;
    } else {
      memoryDedupe.set(key, now);
    }
  }

  if (isDuplicate) return { recorded: false };

  await db.insert(docsSearchMissesTable).values({
    query: normalized,
    locale,
    user_id: userId,
  });

  return { recorded: true };
});
