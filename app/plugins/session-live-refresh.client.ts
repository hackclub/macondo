import { macondoHasEnded } from "~~/shared/macondo-end";

// App-wide because useAuth hydrates `user` only once and nearly every page is
// `layout: false`, so a layout-level heartbeat would never run.
export default defineNuxtPlugin(() => {
  const { isLoggedIn, user, fetchSession } = useAuth();
  const { refresh: refreshStreakToday } = useStreakToday();
  const { refresh: refreshGold } = useGoldBalance();
  const { refresh: refreshStarfruit } = useStarfruitBalance();

  // The min gap collapses bursty focus/visibility/interval triggers, since /api/auth/me is uncached and heavy.
  const INTERVAL_MS = 120_000;
  const MIN_GAP_MS = 20_000;
  // Starts at page load: the session was just fetched (or seeded by the server render), so an
  // immediate refresh on login would only repeat /api/auth/me.
  let lastRun = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refreshAll(force = false): Promise<void> {
    if (!isLoggedIn.value) return;
    const now = Date.now();
    if (!force && now - lastRun < MIN_GAP_MS) return;
    lastRun = now;
    await Promise.allSettled([
      fetchSession(),
      ...(macondoHasEnded() ? [] : [refreshStreakToday()]),
      refreshGold(),
      refreshStarfruit(),
    ]);
    // Debounced server-side (~5 min per user); lets an idle-but-open tab still extend the streak.
    if (!macondoHasEnded() && user.value?.has_hackatime) {
      try {
        await $fetch("/api/users/sync-hackatime", { method: "POST" });
      } catch {
        // Transient; the next tick (or the background cron) retries.
      }
    }
  }

  function startTimer(): void {
    if (timer || !isLoggedIn.value || macondoHasEnded()) return;
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, INTERVAL_MS);
  }
  function stopTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onVisibility(): void {
    if (document.visibilityState === "visible") {
      void refreshAll(); // immediate catch-up when the tab regains focus
      startTimer();
    } else {
      stopTimer();
    }
  }
  function onFocus(): void {
    void refreshAll();
  }

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);

  // The session resolves asynchronously, so poll only once logged in.
  watch(
    isLoggedIn,
    (loggedIn) => {
      if (loggedIn) {
        void refreshAll();
        startTimer();
      } else {
        stopTimer();
      }
    },
    { immediate: true },
  );
});
