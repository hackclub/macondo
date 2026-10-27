import { getSession } from "../../lib/session";
import { getStreakCalendar, streakDayKey } from "../../lib/streaks";

function startOfMonth(monthStr: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid month format, expected YYYY-MM" });
  }
  return `${monthStr}-01`;
}

function endOfMonth(monthStr: string): string {
  const start = new Date(`${monthStr}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return start.toISOString().slice(0, 10);
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const monthRaw = getQuery(event).month;
  // streak_days.day is a local day, so default to the user's local month to avoid off-by-one near UTC midnight.
  const month = typeof monthRaw === "string" && /^\d{4}-\d{2}$/.test(monthRaw)
    ? monthRaw
    : streakDayKey(new Date(), user.timezone).slice(0, 7);

  return {
    month,
    timezone: user.timezone ?? "UTC",
    days: await getStreakCalendar(user.id, startOfMonth(month), endOfMonth(month)),
  };
});
