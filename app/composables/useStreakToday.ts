export const useStreakToday = () => {
  const todaySeconds = useState<number>("streak_today_seconds", () => 0);
  const goalSeconds = useState<number>("streak_today_goal_seconds", () => 3600);
  // From /api/profile/streaks, not /api/auth/me: only this applies the live-seconds
  // override, so the HUD flame and progress bar flip together.
  const workedToday = useState<boolean>("streak_today_worked", () => false);
  const initialized = useState<boolean>("streak_today_initialized", () => false);

  async function refresh(): Promise<void> {
    try {
      const res = await $fetch<{
        today_seconds_logged?: number;
        daily_goal_seconds?: number;
        worked_today?: boolean;
      }>("/api/profile/streaks");
      todaySeconds.value = Number(res.today_seconds_logged ?? 0);
      const goal = Number(res.daily_goal_seconds ?? 3600);
      goalSeconds.value = goal > 0 ? goal : 3600;
      workedToday.value = !!res.worked_today;
      initialized.value = true;
    } catch {
      // Keep last known values on a transient failure.
    }
  }

  return { todaySeconds, goalSeconds, workedToday, initialized, refresh };
};
