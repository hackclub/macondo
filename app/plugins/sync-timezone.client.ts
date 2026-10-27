// First time only: syncing on every login let a wrong-tz device overwrite the saved
// zone and misdate streak days. Later changes go through the settings page.
export default defineNuxtPlugin(() => {
  if (import.meta.server) return;

  const { user, isLoggedIn } = useAuth();

  const captureInitialTimezone = async () => {
    if (!isLoggedIn.value || !user.value) return;
    const stored = user.value.timezone;
    const isDefault = !stored || stored === "UTC";
    if (!isDefault) return;

    let detected: string;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === stored) return;

    try {
      await $fetch("/api/user/timezone", {
        method: "PATCH",
        body: { timezone: detected },
      });
    } catch {
      // Best-effort: streaks still work with the previous/default zone.
    }
  };

  watch(isLoggedIn, (next) => {
    if (next) void captureInitialTimezone();
  }, { immediate: true });
});
