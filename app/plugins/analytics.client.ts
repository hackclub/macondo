import { macondoHasEnded } from "~~/shared/macondo-end";

// Fires on every route change since the server middleware only sees the initial SSR GET.
// Best-effort: analytics must never break navigation.

export default defineNuxtPlugin((nuxtApp) => {
  if (macondoHasEnded()) return;
  const router = useRouter();
  let lastUrl: string | null = null;

  const isExcluded = (path: string) =>
    path.startsWith("/internal") ||
    path.startsWith("/api") ||
    path.startsWith("/_");

  const send = () => {
    try {
      if (isExcluded(window.location.pathname)) return;

      const url = window.location.pathname + window.location.search;
      if (url === lastUrl) return;
      lastUrl = url;

      const payload = JSON.stringify({
        u: url,
        r: document.referrer || undefined,
        w: window.innerWidth || undefined,
      });

      const endpoint = "/api/analytics/event";
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(
          endpoint,
          new Blob([payload], { type: "application/json" }),
        );
      } else {
        void fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      // Never let analytics throw into navigation.
    }
  };

  nuxtApp.hook("app:mounted", () => send());
  router.afterEach(() => {
    // Defer a tick so window.location reflects the resolved route.
    void nextTick(() => send());
  });
});
