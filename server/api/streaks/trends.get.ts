import { getSession } from "../../lib/session";
import { getStreakCalendar, streakDayKey } from "../../lib/streaks";

// The client zero-fills missing days and computes stats so that math stays next to the chart.
export default defineCachedEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const daysRaw = Number(getQuery(event).days);
  const windowDays =
    Number.isFinite(daysRaw) && daysRaw >= 7 && daysRaw <= 120 // allowed window range in days
      ? Math.floor(daysRaw)
      : 30; // default window in days

  // Calendar math on the local day string, matching getUserCurrentStreak.
  const today = streakDayKey(new Date(), user.timezone);
  const startDay = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (windowDays - 1));
    return d.toISOString().slice(0, 10);
  })();

  return {
    start_day: startDay,
    end_day: today,
    window_days: windowDays,
    timezone: user.timezone ?? "UTC",
    days: await getStreakCalendar(user.id, startDay, today),
  };
}, {
  // Matches /api/profile/streaks so the trend chart and progress bar age together.
  maxAge: 30,
  swr: true,
  // Cached handlers keep only these headers; without "cookie" every logged-in request 401s.
  varies: ["cookie"],
  // Key-authed requests carry no cookie and would share the "anon" key across accounts.
  shouldBypassCache: (event) =>
    !getCookie(event, "macondo_session") && !!event.context.apiKeyAuth,
  getKey: (event) => {
    // The dashboard (14 days) and profile chart (30) would collide without the window in the key.
    const token = getCookie(event, "macondo_session");
    const daysRaw = Number(getQuery(event).days);
    const windowDays =
      Number.isFinite(daysRaw) && daysRaw >= 7 && daysRaw <= 120
        ? Math.floor(daysRaw)
        : 30;
    return `streaks:trends:${token ?? "anon"}:${windowDays}`;
  },
});
