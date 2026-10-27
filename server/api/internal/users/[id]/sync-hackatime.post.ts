import db from "../../../../db";
import { users, hackatimeSyncAuditTable } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import {
  classifyHackatimeAuthFailure,
  getAuthenticatedHours,
  getAuthenticatedMe,
  getTrustLevelForUser,
  syncHackatimeTimezone,
} from "../../../../lib/hackatime";
import { getEffectiveHackatimeOAuthToken } from "../../../../lib/dev-debug-flags";
import { isAbleToReview } from "../../../../policies/internal";
import {
  clearStreakCacheForUser,
  extendProjectStreaksFromHackatime,
  extendStreak,
  getUserLinkedHackatimeSecondsToday,
  resetUserProjectStreaks,
} from "../../../../lib/streaks";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target)
    throw createError({ statusCode: 404, statusMessage: "Not Found" });

  const hackatimeToken =
    target.id === actor.id
      ? getEffectiveHackatimeOAuthToken(event, target.hackatime_oauth_token)
      : target.hackatime_oauth_token;

  if (!hackatimeToken) {
    return { ok: false, error: "User has not connected Hackatime OAuth" };
  }

  const me = await getAuthenticatedMe(hackatimeToken);
  if (!me) {
    return { ok: false, error: "Failed to fetch Hackatime user profile" };
  }

  const hours = await getAuthenticatedHours(hackatimeToken);
  if (!hours) {
    // Hackatime blocks restricted users everywhere except /me; bail rather than
    // zero the stored totals, and persist the verdict so the sweeps skip them.
    let verdict = "unknown";
    if (hackatimeToken === target.hackatime_oauth_token) {
      const failure = await classifyHackatimeAuthFailure(hackatimeToken);
      if (failure !== "unknown" && target.hackatime_api_status !== failure) {
        try {
          await db
            .update(users)
            .set({
              hackatime_api_status: failure,
              hackatime_api_status_changed_at: new Date(),
            })
            .where(eq(users.id, id));
        } catch (err) {
          console.error(
            "[sync-hackatime] failed to mark hackatime_api_status",
            err,
          );
        }
      }
      verdict = failure;
    }
    return {
      ok: false,
      error:
        verdict === "api_restricted"
          ? "Hackatime blocks this user's API access (red trust level or pending account deletion); their token is valid but nothing can sync until that clears upstream."
          : verdict === "invalid_token"
            ? "This user's Hackatime token was revoked; they must reconnect Hackatime."
            : "Failed to fetch Hackatime hours (transient upstream failure); try again.",
    };
  }
  const totalSeconds = Math.max(0, Math.floor(hours.total_seconds ?? 0));
  const totalHours = Math.round((totalSeconds / 3600) * 100) / 100; // hours rounded to 2 decimals

  const config = useRuntimeConfig();
  const trustLevel = await getTrustLevelForUser({
    adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
    hackatimeId: target.hackatime_id ?? me.id,
    hackatimeOAuthToken: hackatimeToken,
    email: target.email,
  });

  // Compare seconds, not floored hours, so sub-hour activity still extends the streak.
  const isFirstSync = target.last_hackatime_synced_at === null;
  const previousSecondsRaw = target.last_hackatime_total_seconds;
  const previousSeconds =
    previousSecondsRaw == null
      ? Math.round((target.last_hackatime_total_hours ?? 0) * 3600)
      : previousSecondsRaw;
  const deltaSeconds = isFirstSync ? 0 : Math.max(0, totalSeconds - previousSeconds);
  const deltaHours = Math.round((deltaSeconds / 3600) * 100) / 100;
  const now = new Date();

  await db
    .update(users)
    .set({
      hackatime_id: me.id,
      last_hackatime_total_hours: totalHours,
      last_hackatime_total_seconds: totalSeconds,
      last_hackatime_synced_at: now,
      // A working /hours call heals a stale dead-token mark so the sweeps pick the user back up.
      ...(target.hackatime_api_status !== "ok"
        ? {
            hackatime_api_status: "ok",
            hackatime_api_status_changed_at: now,
          }
        : {}),
      ...(me.slack_id && !target.slack_id
        ? { slack_id: me.slack_id }
        : {}),
      ...(me.github_username && !target.username
        ? { username: me.github_username }
        : {}),
    })
    .where(eq(users.id, id));

  // Recompute streaks in Hackatime's authoritative timezone; no-op when it has none.
  const effectiveTz =
    (await syncHackatimeTimezone({
      userId: id,
      hackatimeId: target.hackatime_id ?? me.id,
      adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
      currentTimezone: target.timezone ?? null,
      currentHackatimeTimezone: target.hackatime_timezone ?? null,
    })) ??
    target.timezone ??
    null;

  let extended = false;
  if (!isFirstSync && deltaSeconds > 0) {
    // Same anti-cheese gate as the public sync: only time on linked projects counts.
    try {
      const linkedSecondsToday = await getUserLinkedHackatimeSecondsToday(id);
      if (linkedSecondsToday > 0) {
        extended = (await extendStreak(id, "hackatime", linkedSecondsToday)).activated;
      }
    } catch (err) {
      console.error("[sync-hackatime] extendStreak failed", err);
    }
  }

  // Clean-slate streak recompute: the ops lever for bad streak state. Idempotent.
  if (!isFirstSync) {
    try {
      await clearStreakCacheForUser(id, effectiveTz);
      const reset = await resetUserProjectStreaks(id);
      if (reset > 0) {
        console.log(
          `[sync-hackatime] reset ${reset} project streak rows for user ${id} before recompute`,
        );
      }
      await extendProjectStreaksFromHackatime(
        id,
        hackatimeToken,
        effectiveTz,
      );
    } catch (err) {
      console.error("[sync-hackatime] extendProjectStreaksFromHackatime failed", err);
    }
  }

  await db.insert(hackatimeSyncAuditTable).values({
    user_id: id,
    total_hours: totalHours,
    delta_hours: deltaHours,
    sync_date: now.toISOString().slice(0, 10), // yyyy-mm-dd
    extended_streak: extended,
    source: isFirstSync ? "first_sync_seed" : "manual_admin",
  });

  return {
    ok: true,
    hackatime_id: me.id,
    hackatime_username: me.github_username,
    slack_uid: me.slack_id,
    total_hours: totalHours,
    delta_hours: deltaHours,
    delta_seconds: deltaSeconds,
    extended_streak: extended,
    trust_level: trustLevel,
  };
});
