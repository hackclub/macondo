<script setup lang="ts">
import { Clock } from "lucide-vue-next";

// 23:59 Eastern on 23 August; -04:00 because Eastern is on daylight time then
const SUBMIT_DEADLINE_MS = Date.parse("2026-08-23T23:59:00-04:00");

// the extension cohort has a later per-user deadline; global one while the session loads
const { user } = useAuth();
const deadlineMs = computed(
  () => user.value?.ship_deadline_ms ?? SUBMIT_DEADLINE_MS,
);

// null until mounted so SSR and the first client paint agree (no hydration mismatch)
const nowMs = ref<number | null>(null);
let tick: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  nowMs.value = Date.now();
  tick = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  if (tick) clearInterval(tick);
});

const countdown = computed(() => {
  if (nowMs.value == null) return null;
  const remaining = deadlineMs.value - nowMs.value;
  if (remaining <= 0) return { expired: true, text: "" };
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    expired: false,
    text: days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
});
</script>

<template>
  <div
    v-if="countdown"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 hidden md:block w-[min(22rem,calc(100vw-2rem))]"
  >
    <div
      class="flex items-center gap-3 w-full px-4 py-2.5 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-ds-brown shadow-xl"
    >
      <Clock class="w-5 h-5 shrink-0" />
      <span class="flex-1 min-w-0 flex items-baseline justify-between gap-2 text-xs font-bold">
        <span class="truncate">{{ $t("dashboard.submit_countdown.deadline_label") }}</span>
        <span
          class="shrink-0 tabular-nums"
          :class="countdown.expired ? 'text-ds-danger' : 'text-ds-brown'"
        >
          {{ countdown.expired ? $t("dashboard.submit_countdown.deadline_passed") : countdown.text }}
        </span>
      </span>
    </div>
  </div>
</template>
