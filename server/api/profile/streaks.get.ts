import { and, eq, isNull, sql } from "drizzle-orm";
import db from "~~/server/db";
import {
  dailyProjectActivityTable,
  projectTable,
  streakDaysTable,
} from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import {
  computeDashboardStreak,
  getUserLinkedHackatimeSecondsToday,
  reconcileFreezesIfStale,
  streakDayKey,
  USER_STREAK_THRESHOLD_SECONDS,
  userQualifiedAnyProjectToday,
} from "~~/server/lib/streaks";

// Cached to collapse the per-tab heartbeat burst. Safe for reconcileFreezesIfStale:
// it's idempotent and also runs uncached via /api/auth/me and the daily cron.
export default defineCachedEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  // Burn pending freezes so the returned count isn't the stale user-row value.
  let freezes = user.streak_freezes_remaining ?? 0;
  try {
    freezes = (await reconcileFreezesIfStale(user.id)).streak_freezes_remaining;
  } catch (err) {
    console.error("[profile/streaks] reconcileFreezesIfStale failed", err);
  }

  // Local day in the user's timezone, matching streak_days.day and last_worked_date.
  const today = streakDayKey(new Date(), user.timezone);
  let workedToday = await userQualifiedAnyProjectToday(user.id, today);

  // streak_days.seconds_logged is hackatime only; add journal seconds to match
  // the combined rule in dayQualifiesForUserStreak.
  const [todayRow] = await db
    .select({ seconds: streakDaysTable.seconds_logged })
    .from(streakDaysTable)
    .where(
      and(eq(streakDaysTable.user_id, user.id), eq(streakDaysTable.day, today)),
    )
    .limit(1);
  const [todayJournalRow] = await db
    .select({
      seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds}), 0)::int`,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, user.id),
        eq(dailyProjectActivityTable.day, today),
      ),
    );
  // The batch sync runs once a day, so stored seconds lag all day for users east
  // of UTC; take the max with live seconds so a hackatime failure can't lower it.
  let liveHackatimeToday = 0;
  try {
    liveHackatimeToday = await getUserLinkedHackatimeSecondsToday(user.id);
  } catch (err) {
    console.error("[profile/streaks] live today-seconds failed", err);
  }
  const todaySeconds =
    Math.max(todayRow?.seconds ?? 0, liveHackatimeToday) +
    Number(todayJournalRow?.seconds ?? 0);

  // Keep worked_today consistent with the live progress bar before the next sync.
  if (!workedToday && todaySeconds >= USER_STREAK_THRESHOLD_SECONDS) {
    workedToday = true;
  }

  const projects = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      project_streak_days: projectTable.project_streak_days,
      last_worked_date: projectTable.last_worked_date,
      auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.user_id, user.id),
        isNull(projectTable.deleted_at),
      ),
    );

  // Same computeDashboardStreak call as the HUD (auth/me) so the numbers never disagree.
  let currentStreak = 0;
  try {
    currentStreak = await computeDashboardStreak(
      user.id,
      user.timezone,
      workedToday,
    );
  } catch (err) {
    console.error("[profile/streaks] current streak lookup failed", err);
  }

  return {
    current_streak: currentStreak,
    streak_freezes_remaining: freezes,
    worked_today: workedToday,
    today_seconds_logged: todaySeconds,
    daily_goal_seconds: USER_STREAK_THRESHOLD_SECONDS,
    projects: projects
      .map((p) => ({
        id: p.id,
        name: p.name,
        project_streak_days: p.project_streak_days,
        last_worked_date: p.last_worked_date,
        worked_today: p.last_worked_date === today,
        auto_use_streak_freezes: p.auto_use_streak_freezes,
      }))
      .sort((a, b) => b.project_streak_days - a.project_streak_days),
  };
}, {
  maxAge: 30,
  swr: true,
  // The cached handler keeps ONLY these headers; without "cookie" every request 401s.
  varies: ["cookie"],
  // Key-authed requests have no cookie and would share the "anon" entry, getting
  // another account's cached streaks.
  shouldBypassCache: (event) =>
    !getCookie(event, "macondo_session") && !!event.context.apiKeyAuth,
  getKey: (event) => {
    // No token means the handler 401s, so nothing is ever cached under "anon".
    const token = getCookie(event, "macondo_session");
    return `profile:streaks:${token ?? "anon"}`;
  },
});
