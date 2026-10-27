<script setup lang="ts">
import { computed, ref } from "vue";
import { Search, AlertCircle, Check, RefreshCw } from "lucide-vue-next";

definePageMeta({ layout: "internal" });

type MissRow = {
  query: string;
  locale: "en" | "es";
  count: number;
  last_seen: string;
  first_seen: string;
  signed_in_count: number;
};

type Totals = {
  total_misses: number;
  distinct_queries: number;
  misses_last_24h: number;
};

const includeDismissed = ref(false);

const {
  data,
  pending,
  refresh,
} = useFetch<{ rows: MissRow[]; totals: Totals }>(
  "/api/internal/docs-misses",
  {
    query: { includeDismissed, limit: 100 },
    server: false,
    watch: [includeDismissed],
  },
);

const rows = computed<MissRow[]>(() => data.value?.rows ?? []);
const totals = computed<Totals>(
  () =>
    data.value?.totals ?? {
      total_misses: 0,
      distinct_queries: 0,
      misses_last_24h: 0,
    },
);

const dismissTarget = ref<MissRow | null>(null);
const dismissBusy = ref(false);
const dismissError = ref<string | null>(null);

function askDismiss(row: MissRow) {
  dismissTarget.value = row;
  dismissError.value = null;
}

function cancelDismiss() {
  dismissTarget.value = null;
  dismissError.value = null;
}

async function confirmDismiss() {
  const target = dismissTarget.value;
  if (!target) return;
  dismissBusy.value = true;
  dismissError.value = null;
  try {
    await $fetch("/api/internal/docs-misses/dismiss", {
      method: "POST",
      body: { query: target.query, locale: target.locale },
    });
    dismissTarget.value = null;
    await refresh();
  } catch (err) {
    const e = err as { data?: { message?: string; statusMessage?: string } };
    dismissError.value =
      e?.data?.message ?? e?.data?.statusMessage ?? "Failed to dismiss";
  } finally {
    dismissBusy.value = false;
  }
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const m = Math.round((Date.now() - ts) / 60000); // ms to minutes
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}
</script>

<template>
  <div class="px-6 py-8 max-w-6xl mx-auto">
    <div class="mb-8 flex items-start gap-3">
      <Search :size="22" class="text-zinc-400 mt-1 shrink-0" />
      <div class="flex-1">
        <h1 class="text-2xl font-bold text-white leading-tight">Docs Search Misses</h1>
        <p class="text-zinc-400 text-sm mt-1">
          Queries users typed into the docs Cmd+K that returned no results.
          Use this to find gaps in docs content and the synonym map.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 px-3 py-1.5 transition-colors"
        :disabled="pending"
        @click="refresh()"
      >
        <RefreshCw :size="12" :class="pending ? 'animate-spin' : ''" />
        Refresh
      </button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <div class="border border-zinc-800 bg-zinc-900/40 p-4">
        <div class="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-1">
          Distinct missed queries
        </div>
        <div class="text-2xl font-bold text-white tabular-nums">
          {{ totals.distinct_queries }}
        </div>
      </div>
      <div class="border border-zinc-800 bg-zinc-900/40 p-4">
        <div class="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-1">
          Total miss events
        </div>
        <div class="text-2xl font-bold text-white tabular-nums">
          {{ totals.total_misses }}
        </div>
      </div>
      <div class="border border-zinc-800 bg-zinc-900/40 p-4">
        <div class="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-1">
          Last 24h
        </div>
        <div class="text-2xl font-bold text-white tabular-nums">
          {{ totals.misses_last_24h }}
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between mb-3">
      <span class="text-xs uppercase tracking-widest font-bold text-zinc-500">
        Top missed queries
      </span>
      <label class="inline-flex items-center gap-2 text-xs text-zinc-400 select-none cursor-pointer">
        <input
          v-model="includeDismissed"
          type="checkbox"
          class="accent-zinc-500"
        >
        Include dismissed
      </label>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-black/30 text-[10px] uppercase tracking-widest font-bold text-zinc-500">
          <tr>
            <th class="px-4 py-2.5 text-left">Query</th>
            <th class="px-3 py-2.5 text-left w-16">Locale</th>
            <th class="px-3 py-2.5 text-right w-16">Count</th>
            <th class="px-3 py-2.5 text-right w-20">Signed in</th>
            <th class="px-3 py-2.5 text-right w-28">Last seen</th>
            <th class="px-3 py-2.5 text-right w-28">First seen</th>
            <th class="px-3 py-2.5 text-right w-32">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="pending && rows.length === 0">
            <td colspan="7" class="px-4 py-8 text-center text-zinc-500 text-sm">
              Loading…
            </td>
          </tr>
          <tr v-else-if="rows.length === 0">
            <td colspan="7" class="px-4 py-10 text-center text-zinc-500 text-sm">
              <AlertCircle :size="18" class="inline mb-2 text-zinc-600" /><br>
              No missed queries right now. Either search is performing well
              or no one has searched the docs recently.
            </td>
          </tr>
          <tr
            v-for="row in rows"
            :key="`${row.locale}:${row.query}`"
            class="border-t border-zinc-800 hover:bg-zinc-800/40 transition-colors"
          >
            <td class="px-4 py-2.5 font-mono text-zinc-200 break-all">{{ row.query }}</td>
            <td class="px-3 py-2.5 text-zinc-400 uppercase text-xs font-bold tracking-wider">{{ row.locale }}</td>
            <td class="px-3 py-2.5 text-right text-white font-bold tabular-nums">{{ row.count }}</td>
            <td class="px-3 py-2.5 text-right text-zinc-400 tabular-nums">{{ row.signed_in_count }}</td>
            <td class="px-3 py-2.5 text-right text-zinc-400 tabular-nums">{{ formatRelative(row.last_seen) }}</td>
            <td class="px-3 py-2.5 text-right text-zinc-500 tabular-nums">{{ formatRelative(row.first_seen) }}</td>
            <td class="px-3 py-2.5 text-right">
              <button
                type="button"
                class="text-[11px] font-bold uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-700/40 hover:border-emerald-500 px-2.5 py-1 transition-colors"
                @click="askDismiss(row)"
              >
                Mark satisfied
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-[11px] text-zinc-500 mt-4 leading-relaxed">
      Marking a query as <span class="text-emerald-300 font-bold">satisfied</span>
      stamps every active row for that (query, locale) as dismissed without
      deleting them, so historical signal is preserved.
      Dismiss once you've added an FAQ entry, updated docs, or extended
      <code class="bg-black/40 px-1 py-0.5 border border-zinc-800 text-zinc-300">app/composables/docsSearchSynonyms.ts</code>.
    </p>

    <Transition name="modal-fade" appear>
      <div
        v-if="dismissTarget"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="cancelDismiss"
      >
        <div class="modal-fade-panel relative bg-zinc-950 border border-emerald-700/60 p-6 w-full max-w-md flex flex-col gap-4">
          <h2 class="text-emerald-200 font-bold text-lg">Mark "{{ dismissTarget.query }}" as satisfied?</h2>
          <p class="text-zinc-300 text-sm">
            Every active row for this query in
            <span class="uppercase font-bold text-zinc-100">{{ dismissTarget.locale }}</span>
            ({{ dismissTarget.count }}
            <template v-if="dismissTarget.count === 1">event</template>
            <template v-else>events</template>)
            will be stamped as dismissed.
            New misses will start a fresh count.
            Do this once the gap is closed (FAQ entry added, docs updated,
            synonym extended).
          </p>
          <p v-if="dismissError" class="text-red-400 text-xs">{{ dismissError }}</p>
          <div class="flex gap-2 justify-end">
            <button
              class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
              :disabled="dismissBusy"
              @click="cancelDismiss"
            >
              Cancel
            </button>
            <button
              class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              :disabled="dismissBusy"
              @click="confirmDismiss"
            >
              <Check :size="14" />
              {{ dismissBusy ? "Dismissing…" : "Mark satisfied" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-panel {
  animation: modal-fade-pop-in 0.18s ease-out;
}
@keyframes modal-fade-pop-in {
  from { transform: translateY(-6px) scale(0.98); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
</style>
