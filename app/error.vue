<script setup lang="ts">
import { reportClientError } from "~/utils/reportClientError";

const props = defineProps<{
  error: {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
    stack?: string;
  };
}>();

const status = computed(() => props.error?.statusCode ?? 500);
const isNotFound = computed(() => status.value === 404);

// /internal/** is client-only, so window exists there; public 500s may render on the server.
const isInternal =
  import.meta.client && window.location.pathname.startsWith("/internal");

// 4xx are intentional and visible server-side; only beacon unexpected 5xx.
onMounted(() => {
  if (status.value >= 500) {
    reportClientError({
      source: "error-page",
      message:
        props.error?.message ?? props.error?.statusMessage ?? "fatal error",
      stack: props.error?.stack ?? "",
      statusCode: status.value,
    });
  }
});

// Recovers a tab stuck on a stale bundle.
function hardReload() {
  if (import.meta.client) window.location.reload();
}
function goHome() {
  clearError({ redirect: "/dashboard" });
}

const heading = computed(() =>
  isNotFound.value ? "We couldn't find that page" : "Something went sideways",
);
const detail = computed(() =>
  isNotFound.value
    ? "The page you're looking for isn't here. It may have moved or never existed."
    : "An error stopped this page from loading. A quick reload usually clears it. If it keeps happening, let us know in the support channel.",
);
</script>

<template>
  <div
    :class="
      isInternal
        ? 'min-h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center p-6'
        : 'min-h-screen bg-parchment text-ds-brown flex items-center justify-center p-6'
    "
  >
    <div
      :class="
        isInternal
          ? 'w-full max-w-md bg-zinc-900/60 border border-zinc-800 p-8'
          : 'w-full max-w-md bg-parchment border-[3px] border-ds-brown p-8'
      "
    >
      <p
        :class="
          isInternal
            ? 'text-xs tracking-widest font-bold text-zinc-500 mb-3'
            : 'text-xs tracking-widest font-bold text-ds-brown/60 mb-3'
        "
      >
        ERROR {{ status }}
      </p>
      <h1
        :class="
          isInternal
            ? 'text-2xl font-bold mb-3 text-white'
            : 'text-3xl font-title mb-3 text-ds-brown'
        "
      >
        {{ heading }}
      </h1>
      <p class="mb-6 leading-relaxed" :class="isInternal ? 'text-zinc-400' : 'text-ds-brown/80'">
        {{ detail }}
      </p>
      <div class="flex flex-wrap gap-3">
        <button v-if="!isNotFound" class="ds-btn-primary" @click="hardReload">
          Reload page
        </button>
        <button class="ds-btn-ghost" @click="goHome">
          Back to farm
        </button>
      </div>
    </div>
  </div>
</template>
