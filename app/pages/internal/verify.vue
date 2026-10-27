<script setup lang="ts">
const route = useRoute();
const { t } = useI18n();

definePageMeta({
  layout: false,
});

const returnTo = computed(() => {
  const candidate = typeof route.query.return_to === "string" ? route.query.return_to : "";
  return candidate.startsWith("/internal") ? candidate : "/internal/dashboard";
});

const verifySession = () => {
  window.location.href = `/api/internal/reauth/login?return_to=${encodeURIComponent(returnTo.value)}`;
};

if (import.meta.client) {
  const { data } = useFetch<{ verified: boolean }>("/api/internal/reauth/status", {
    server: false,
  });

  watchEffect(() => {
    if (data.value?.verified) {
      void navigateTo(returnTo.value, { replace: true });
    }
  });
}
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-black px-6 text-white bg-[linear-gradient(to_right,#ffffff1a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff1a_1px,transparent_1px)] bg-[size:40px_40px]"
  >
    <div
      class="w-full max-w-lg border border-zinc-800 bg-zinc-900/40 p-6 shadow-2xl backdrop-blur-sm"
    >
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-2">
          <h2 class="text-xl font-semibold text-white">
            {{ t("internal.warning_title") }}
          </h2>
          <p class="text-sm leading-relaxed text-zinc-400">
            {{ t("internal.warning_description") }}
          </p>
        </div>

        <div class="flex justify-end gap-3 border-t border-zinc-800 pt-4">
          <NuxtLink
            to="/dashboard"
            class="border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
          >
            {{ t("internal.exit_internal") }}
          </NuxtLink>
          <button
            class="bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
            @click="verifySession"
          >
            {{ t("internal.verify_session") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
