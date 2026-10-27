// Feeds the "your day ends at X PM" hint; streak math doesn't depend on it.

export default defineNuxtPlugin(async () => {
  const { user } = useAuth();
  if (!user.value) return;

  const detected = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  })();
  if (!detected) return;

  if ((user.value.timezone ?? "UTC") === detected) return;

  try {
    const result = await $fetch<{ updated: boolean; timezone: string }>(
      "/api/auth/timezone",
      {
        method: "POST",
        body: { timezone: detected },
      },
    );
    if (result?.updated && user.value) {
      user.value.timezone = result.timezone;
    }
  } catch (err) {
    // Debug level so locked-down browsers don't spam the console; the next mount retries.
    console.debug("[timezone-sync] failed", err);
  }
});
