import { eq } from "drizzle-orm";
import db from "../../db";
import { users } from "../../db/schema";
import { getSession } from "../../lib/session";
import { getAuthenticatedProjects } from "../../lib/hackatime";
import { getEffectiveHackatimeOAuthToken } from "../../lib/dev-debug-flags";
import { checkRateLimit } from "../../lib/rate-limit";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  // uncached, so every call hits hackatime; cap to protect the user's quota and our load
  const rate = await checkRateLimit(user.id, "hackatime:projects", 30, 60); // 30 calls per minute
  if (!rate.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.`,
    });
  }

  const [dbUser] = await db
    .select({ hackatime_oauth_token: users.hackatime_oauth_token })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const hackatimeToken = getEffectiveHackatimeOAuthToken(
    event,
    dbUser?.hackatime_oauth_token ?? null,
  );

  if (!hackatimeToken) {
    // not linked yet is expected, and the panels poll this, so don't log
    return { projects: [] as { name: string; total_seconds: number }[] };
  }

  // `since` (the project's created_at) adds per-project hours next to the lifetime total
  const query = getQuery(event);
  const sinceParam = typeof query.since === "string" ? query.since : null;
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const validSince = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

  const [result, windowedResult] = await Promise.all([
    getAuthenticatedProjects(hackatimeToken),
    validSince
      ? getAuthenticatedProjects(hackatimeToken, {
          startDate: validSince.toISOString().slice(0, 10),
        })
      : Promise.resolve(null),
  ]);

  if (!result) {
    console.log("[hackatime/projects] upstream returned null");
    return { projects: [] as { name: string; total_seconds: number; total_seconds_in_window?: number }[] };
  }

  const programStartDate = new Date("2026-04-01T00:00:00Z");
  const filtered = result.projects.filter((p) => {
    if (!p.most_recent_heartbeat) return false;
    return new Date(p.most_recent_heartbeat) >= programStartDate;
  });

  const windowedByName = new Map<string, number>();
  if (windowedResult?.projects?.length) {
    for (const p of windowedResult.projects) {
      windowedByName.set(p.name, p.total_seconds ?? 0);
    }
  }

  const mapped = filtered.map((p) => ({
    name: p.name,
    total_seconds: p.total_seconds,
    ...(validSince
      ? { total_seconds_in_window: windowedByName.get(p.name) ?? 0 }
      : {}),
  }));

  // hackatime creates an entry per folder name, so put active projects first and
  // let the picker collapse the zero-hour tail
  const activityOf = (p: (typeof mapped)[number]) =>
    validSince ? (p.total_seconds_in_window ?? 0) : p.total_seconds;
  mapped.sort(
    (a, b) => activityOf(b) - activityOf(a) || a.name.localeCompare(b.name),
  );

  return { projects: mapped };
});
