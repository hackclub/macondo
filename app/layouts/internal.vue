<script setup lang="ts">
const route = useRoute();
const isProtectedInternalRoute = computed(
  () => route.path.startsWith("/internal") && route.path !== "/internal/verify",
);

if (import.meta.client) {
  const lastActivityAt = ref(Date.now());
  let heartbeatInFlight = false;
  let lastHeartbeatAt = 0;
  let idleInterval: ReturnType<typeof window.setInterval> | null = null;

  const getReturnTo = () => encodeURIComponent(route.fullPath);
  const sendToVerify = () =>
    navigateTo(`/internal/verify?return_to=${getReturnTo()}`, { replace: true });

  const sendHeartbeat = async () => {
    if (!isProtectedInternalRoute.value || heartbeatInFlight) return;

    heartbeatInFlight = true;

    try {
      await $fetch("/api/internal/reauth/heartbeat", { method: "POST" });
      lastHeartbeatAt = Date.now();
    } catch (err) {
      // Only 401/403 redirects; transient mobile network errors shouldn't bounce the user out.
      const status = (err as { statusCode?: number; response?: { status?: number } })?.statusCode
        ?? (err as { statusCode?: number; response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        await sendToVerify();
      } else {
        // Retry on next activity in case the failure was real but had no status code.
        lastHeartbeatAt = 0;
      }
    } finally {
      heartbeatInFlight = false;
    }
  };

  const markActivity = () => {
    if (!isProtectedInternalRoute.value) return;

    lastActivityAt.value = Date.now();

    // Well inside the 10-minute reauth TTL, so the session never lapses.
    if (Date.now() - lastHeartbeatAt >= 120_000) { // heartbeat at most every 2 minutes
      void sendHeartbeat();
    }
  };

  const checkIdle = () => {
    if (!isProtectedInternalRoute.value) return;

    if (Date.now() - lastActivityAt.value >= 10 * 60 * 1000) { // 10 minutes idle
      void sendToVerify();
    }
  };

  const attachActivityListeners = () => {
    const events = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markActivity();
        checkIdle();
      }
    };

    for (const eventName of events) {
      window.addEventListener(eventName, markActivity, { passive: true });
    }

    window.addEventListener("focus", markActivity);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, markActivity);
      }

      window.removeEventListener("focus", markActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  };

  let detachListeners: (() => void) | null = null;

  onMounted(() => {
    lastActivityAt.value = Date.now();
    lastHeartbeatAt = Date.now();
    detachListeners = attachActivityListeners();
    idleInterval = window.setInterval(checkIdle, 15_000);
  });

  onBeforeUnmount(() => {
    detachListeners?.();
    if (idleInterval) {
      window.clearInterval(idleInterval);
    }
  });

  watch(
    () => route.fullPath,
    () => {
      lastActivityAt.value = Date.now();
    },
  );
}
</script>

<template>
  <div
    class="bg-black text-white min-h-screen w-full bg-[linear-gradient(to_right,#ffffff1a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff1a_1px,transparent_1px)] bg-[size:40px_40px] relative"
  >
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:border-2 focus:border-black focus:font-bold focus:no-underline"
    >
      {{ $t('a11y.skip_to_content') }}
    </a>
    <InternalNavbar />

    <main id="main-content" tabindex="-1" class="relative z-10">
      <slot />
    </main>
  </div>
</template>

<style>
.internal-layout,
.internal-layout *,
.internal-layout *::before,
.internal-layout *::after {
  font-family: 'Inter', sans-serif !important;
}
</style>
