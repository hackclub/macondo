<script setup lang="ts">
import { LogOut } from "lucide-vue-next";

const { user, stopImpersonating } = useAuth();

const leaving = ref(false);
const error = ref("");

const impersonation = computed(() => user.value?.impersonation ?? null);
const actorName = computed(
  () => impersonation.value?.actor.username ?? "staff",
);
const targetName = computed(
  () => user.value?.username || user.value?.email || "this user",
);

async function leaveImpersonation() {
  if (leaving.value) return;

  leaving.value = true;
  error.value = "";

  try {
    await stopImpersonating();
  } catch (err: unknown) {
    error.value =
      (err as { data?: { message?: string; statusMessage?: string } })?.data?.message ??
      (err as { data?: { message?: string; statusMessage?: string } })?.data?.statusMessage ??
      "Failed to leave impersonation";
    leaving.value = false;
  }
}
</script>

<template>
  <div
    v-if="impersonation"
    class="fixed bottom-5 left-1/2 z-[90] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 border border-amber-300/40 bg-black/90 text-white shadow-2xl backdrop-blur-md"
  >
    <div class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <p class="truncate text-sm font-bold text-amber-100">
          Impersonating {{ targetName }}
        </p>
        <p class="truncate text-xs text-amber-100/60">
          via {{ actorName }}
        </p>
      </div>

      <button
        type="button"
        class="inline-flex items-center justify-center gap-2 border border-amber-200/40 bg-amber-200 px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70"
        :disabled="leaving"
        @click="leaveImpersonation"
      >
        <LogOut class="h-4 w-4" />
        {{ leaving ? "Leaving..." : "Leave impersonation" }}
      </button>
    </div>

    <p
      v-if="error"
      class="border-t border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100"
    >
      {{ error }}
    </p>
  </div>
</template>
