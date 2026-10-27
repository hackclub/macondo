<script setup lang="ts">
// The ban reason survives a hard refresh because fetchSession re-runs and repopulates useAuth.
const { macondoBan, loading, signOut } = useAuth();

const ready = computed(() => !loading.value);

watch(
  [ready, macondoBan],
  ([isReady, ban]) => {
    if (isReady && !ban) {
      navigateTo("/dashboard", { replace: true });
    }
  },
  { immediate: true },
);

const isTemp = computed(() => !!macondoBan.value?.until);
const untilLabel = computed(() => {
  const until = macondoBan.value?.until;
  if (!until) return "";
  const d = new Date(until);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
});
</script>

<template>
  <div
    class="min-h-screen bg-parchment text-ds-brown flex items-center justify-center p-6"
  >
    <div class="w-full max-w-md bg-parchment border-[3px] border-ds-brown p-8">
      <p class="text-xs tracking-widest font-bold text-ds-brown/60 mb-3">
        ACCOUNT SUSPENDED
      </p>
      <h1 class="text-3xl font-title mb-3 text-ds-brown">
        You've been banned from Macondo
      </h1>

      <p class="mb-4 leading-relaxed text-ds-brown/80">
        <template v-if="isTemp">
          Your access is temporarily suspended<span v-if="untilLabel">
            until <strong>{{ untilLabel }}</strong></span
          >.
        </template>
        <template v-else>
          Your access has been permanently suspended.
        </template>
      </p>

      <div
        v-if="macondoBan?.reason"
        class="mb-6 border-l-[3px] border-ds-brown/40 pl-3"
      >
        <p class="text-xs tracking-widest font-bold text-ds-brown/60 mb-1">
          REASON
        </p>
        <p class="leading-relaxed text-ds-brown">{{ macondoBan.reason }}</p>
      </div>

      <p class="mb-6 text-sm leading-relaxed text-ds-brown/70">
        If you believe this is a mistake, reach out to us at macondo@hackclub.com
      </p>
    </div>
  </div>
</template>
