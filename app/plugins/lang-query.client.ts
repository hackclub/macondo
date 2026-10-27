// useI18n needs a setup context, so i18n comes from nuxtApp.$i18n.

import type { Composer } from "vue-i18n";

const SUPPORTED = new Set(["en", "es", "pt"]);

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter();
  // Typed loosely: the $i18n shape varies by version.
  const i18n = (nuxtApp as unknown as { $i18n: Composer & { setLocale: (code: string) => Promise<void> | void } }).$i18n;
  if (!i18n || !i18n.setLocale) return;

  async function apply(to: { path: string; query: Record<string, unknown>; hash: string }) {
    const raw = to.query.lang;
    if (!raw) return;
    const code = (Array.isArray(raw) ? raw[0] : raw)?.toString().toLowerCase();
    if (!code || !SUPPORTED.has(code)) return;

    if (code !== i18n.locale.value) {
      await i18n.setLocale(code);
    }

    // Strip ?lang= so a refresh doesn't keep re-applying it.
    const rest: Record<string, unknown> = { ...to.query };
    delete rest.lang;
    router.replace({ path: to.path, query: rest as Record<string, string>, hash: to.hash });

    try {
      await $fetch("/api/user/locale", {
        method: "PATCH",
        body: { locale: code },
      });
    } catch {
      // 401 when logged out; the cookie locale from setLocale still applies
    }
  }

  // The route is already resolved when client plugins run.
  const route = router.currentRoute.value;
  void apply({ path: route.path, query: route.query, hash: route.hash });

  router.afterEach((to) => {
    void apply({ path: to.path, query: to.query, hash: to.hash });
  });
});
