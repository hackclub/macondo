<script setup lang="ts">
import { ChevronRight, ExternalLink } from "lucide-vue-next";
import type { Component } from "vue";

import { useRealtime } from "~/composables/useRealtime";

const Line = ref<Component | null>(null);
onMounted(async () => {
  const [chartJs, vueChartjs] = await Promise.all([
    import("chart.js"),
    import("vue-chartjs"),
  ]);
  chartJs.Chart.register(
    chartJs.CategoryScale,
    chartJs.LinearScale,
    chartJs.PointElement,
    chartJs.LineElement,
    chartJs.Filler,
    chartJs.Tooltip,
    chartJs.Title,
    chartJs.Legend,
  );
  Line.value = vueChartjs.Line as unknown as Component;
});

definePageMeta({ layout: "internal" });

type Ticket = {
  id: number;
  user_id: string;
  subject: string;
  category: string;
  priority: string;
  status: "open" | "claimed" | "resolved" | "closed";
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  author_email: string | null;
  author_image: string | null;
  claimed_by: { id: string; username: string | null } | null;
};

type SupportStats = {
  totals: {
    total: number;
    open: number;
    claimed: number;
    resolved: number;
    closed: number;
  };
  avg_first_response_minutes: number | null;
  longest_open_hours: number | null;
  longest_open_ticket_id: number | null;
  series: Array<{ date: string; created: number; resolved: number }>;
};

type LeaderboardEntry = {
  user_id: string;
  username: string | null;
  image: string | null;
  slack_id: string | null;
  count: number;
};
type LeaderboardResponse = {
  all_time: LeaderboardEntry[];
  this_week: LeaderboardEntry[];
  today: LeaderboardEntry[];
};

// Inline preview: /internal/** is ssr:false, so opening each ticket in a new tab pays a cold SPA boot.
type TicketDetail = {
  ticket: { body: string };
  messages: Array<{
    id: number;
    body: string;
    author_kind: string;
    author_name: string | null;
    is_internal_note: boolean;
    deleted_at: string | null;
    created_at: string;
  }>;
};

const items = ref<Ticket[]>([]);
const loading = ref(false);
// One row expands at a time; re-opening refetches so the thread is never stale.
const expandedId = ref<number | null>(null);
const detail = ref<TicketDetail | null>(null);
const detailLoading = ref(false);
const detailFailed = ref(false);

async function toggleExpand(id: number): Promise<void> {
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
  detail.value = null;
  detailFailed.value = false;
  detailLoading.value = true;
  try {
    const res = await $fetch<TicketDetail>(
      `/api/internal/support/tickets/${id}`,
    );
    // Drop a response that lost the race to a newer row click.
    if (expandedId.value !== id) return;
    detail.value = res;
  } catch (err) {
    console.error("[admin-support] ticket detail load failed", err);
    if (expandedId.value === id) detailFailed.value = true;
  } finally {
    if (expandedId.value === id) detailLoading.value = false;
  }
}
const stats = ref<SupportStats | null>(null);
const leaderboard = ref<LeaderboardResponse | null>(null);
const includeToday = ref(false);

// YYYY-MM-DD in EST, matching the stats endpoint's day bucket keys.
function todayInEst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await $fetch<SupportStats>("/api/internal/support/stats");
  } catch (err) {
    console.error("[admin-support] stats load failed", err);
  }
}

async function loadLeaderboard(): Promise<void> {
  try {
    leaderboard.value = await $fetch<LeaderboardResponse>(
      "/api/internal/support/leaderboard",
    );
  } catch (err) {
    console.error("[admin-support] leaderboard load failed", err);
  }
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "text-amber-300 font-bold";
  if (rank === 2) return "text-zinc-300 font-bold";
  if (rank === 3) return "text-orange-400 font-bold";
  return "text-zinc-500";
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

// The partial current day is dropped by default so it doesn't read as a real dip.
const chartData = computed(() => {
  const all = stats.value?.series ?? [];
  const today = todayInEst();
  const series = includeToday.value ? all : all.filter((row) => row.date !== today);
  return {
    labels: series.map((row) => row.date.slice(5)), // MM-DD
    datasets: [
      {
        label: "Created",
        data: series.map((row) => row.created),
        borderColor: "#fbbf24",
        backgroundColor: "rgba(251, 191, 36, 0.18)",
        fill: true,
        tension: 0.35,
        pointRadius: 2,
      },
      {
        label: "Resolved",
        data: series.map((row) => row.resolved),
        borderColor: "#34d399",
        backgroundColor: "rgba(52, 211, 153, 0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: 2,
      },
    ],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: "#d4d4d8" },
      position: "top" as const,
    },
    tooltip: { mode: "index" as const, intersect: false },
  },
  scales: {
    x: { ticks: { color: "#71717a", maxRotation: 0 }, grid: { display: false } },
    y: {
      ticks: { color: "#71717a", precision: 0 },
      grid: { color: "rgba(255,255,255,0.05)" },
      beginAtZero: true,
    },
  },
};

function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const statusFilter = ref<"open" | "claimed" | "resolved" | "closed" | "all">("open");
const categoryFilter = ref<string>("");
const priorityFilter = ref<string>("");
const mine = ref(false);
const q = ref("");
const sort = ref<"newest" | "oldest" | "updated" | "priority">("newest");
const currentPage = ref(1);
const itemsPerPage = 50;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / itemsPerPage)));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (statusFilter.value !== "all") params.set("status", statusFilter.value);
    if (categoryFilter.value) params.set("category", categoryFilter.value);
    if (priorityFilter.value) params.set("priority", priorityFilter.value);
    if (mine.value) params.set("mine", "1");
    if (q.value.trim()) params.set("q", q.value.trim());
    params.set("sort", sort.value);
    params.set("page", String(currentPage.value));
    params.set("limit", String(itemsPerPage));
    const res = await $fetch<{ items: Ticket[]; total: number }>(
      `/api/internal/support/tickets?${params.toString()}`,
    );
    items.value = res.items;
    total.value = res.total ?? 0;
    // Collapse so the panel can't show a thread whose row is no longer listed.
    expandedId.value = null;
    detail.value = null;
  } catch (err) {
    console.error("[admin-support] load failed", err);
  } finally {
    loading.value = false;
  }
}

function setStatus(s: typeof statusFilter.value): void {
  statusFilter.value = s;
}

function ageColor(createdAt: string, status: string): string {
  if (status === "resolved" || status === "closed") return "text-zinc-500";
  const diffHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (diffHours < 24) return "text-emerald-300";
  if (diffHours < 72) return "text-amber-300";
  return "text-red-300 font-bold";
}

function ageLabel(createdAt: string): string {
  const diffHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (diffHours < 1) return "< 1h";
  if (diffHours < 24) return `${Math.round(diffHours)}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function statusPill(status: Ticket["status"]): string {
  if (status === "open") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "claimed") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  if (status === "resolved") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return "border-zinc-700 bg-zinc-800/40 text-zinc-400";
}

watch([statusFilter, categoryFilter, priorityFilter, mine, sort], () => {
  currentPage.value = 1;
  void load();
});

function submitSearch(): void {
  currentPage.value = 1;
  void load();
}

function onPage(p: number): void {
  currentPage.value = p;
  void load();
}

// Debounced so a burst of queue events doesn't hammer the list endpoint.
const rt = useRealtime();
let queueRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (queueRefreshTimer) return;
  queueRefreshTimer = setTimeout(() => {
    queueRefreshTimer = null;
    void load();
    void loadStats();
    void loadLeaderboard();
  }, 800);
}
let unsubQueue: (() => void) | null = null;

onMounted(() => {
  void load();
  void loadStats();
  void loadLeaderboard();
  unsubQueue = rt.subscribe("tickets:queue:internal", () => {
    scheduleRefresh();
  });
});

onBeforeUnmount(() => {
  unsubQueue?.();
  if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
});
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-6xl mx-auto flex flex-col gap-6">
      <div class="flex flex-col gap-1">
        <h1 class="text-3xl font-bold text-white tracking-tight">Support</h1>
        <p class="text-zinc-400 text-sm mt-1">
          User tickets filed from the help widget or posted in the Macondo help channel.
        </p>
      </div>

      <section v-if="stats" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-1">
            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Total tickets</p>
            <p class="text-2xl font-bold text-white">{{ stats.totals.total }}</p>
          </div>
          <div class="border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col gap-1">
            <p class="text-[10px] uppercase tracking-widest text-amber-300 font-bold">Open</p>
            <p class="text-2xl font-bold text-amber-100">{{ stats.totals.open }}</p>
          </div>
          <div class="border border-blue-500/30 bg-blue-500/10 p-4 flex flex-col gap-1">
            <p class="text-[10px] uppercase tracking-widest text-blue-300 font-bold">Claimed</p>
            <p class="text-2xl font-bold text-blue-100">{{ stats.totals.claimed }}</p>
          </div>
          <div class="border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-col gap-1">
            <p class="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Resolved</p>
            <p class="text-2xl font-bold text-emerald-100">{{ stats.totals.resolved }}</p>
          </div>
          <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-1">
            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Avg first response</p>
            <p class="text-2xl font-bold text-white">{{ formatMinutes(stats.avg_first_response_minutes) }}</p>
            <p class="text-[10px] text-zinc-500">last 30 days</p>
          </div>
          <NuxtLink
            :to="stats.longest_open_ticket_id ? `/internal/support/${stats.longest_open_ticket_id}` : '#'"
            class="border border-red-500/30 bg-red-500/10 p-4 flex flex-col gap-1 transition-colors"
            :class="stats.longest_open_ticket_id ? 'hover:bg-red-500/20 cursor-pointer' : 'cursor-default opacity-70'"
          >
            <p class="text-[10px] uppercase tracking-widest text-red-300 font-bold">Longest open</p>
            <p class="text-2xl font-bold text-red-100">{{ formatHours(stats.longest_open_hours) }}</p>
            <p v-if="stats.longest_open_ticket_id" class="text-[10px] text-red-300">Ticket #{{ stats.longest_open_ticket_id }}</p>
            <p v-else class="text-[10px] text-red-300/60">No open tickets</p>
          </NuxtLink>
        </div>

        <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Activity</p>
              <h2 class="text-lg font-bold text-white">Tickets, last 30 days</h2>
            </div>
            <div class="flex items-center gap-3 text-xs text-zinc-500">
              <span>Created vs resolved per day, {{ includeToday ? "through today" : "through yesterday" }}.</span>
              <label class="flex items-center gap-1.5 text-zinc-400 select-none cursor-pointer">
                <input v-model="includeToday" type="checkbox" class="accent-white">
                <span>Include today (partial)</span>
              </label>
            </div>
          </div>
          <div class="h-[260px]">
            <component :is="Line" v-if="Line" :data="chartData" :options="chartOptions" />
          </div>
        </div>

        <div v-if="leaderboard" class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 class="text-lg font-bold text-white">Handler leaderboard</h2>
            <span class="text-xs text-zinc-500">Tickets handled, credited to the claimer, top 10 each</span>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div
              v-for="col in [
                { key: 'all_time' as const, label: 'All time', rows: leaderboard.all_time },
                { key: 'this_week' as const, label: 'This week', rows: leaderboard.this_week },
                { key: 'today' as const, label: 'Today', rows: leaderboard.today },
              ]"
              :key="col.key"
              class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3"
            >
              <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{{ col.label }}</p>
              <div v-if="col.rows.length === 0" class="text-xs text-zinc-500 italic">
                Nothing handled yet.
              </div>
              <ol v-else class="flex flex-col gap-2">
                <li
                  v-for="(entry, i) in col.rows"
                  :key="entry.user_id"
                  class="flex items-center gap-2 text-sm"
                >
                  <span class="w-5 text-right text-xs tabular-nums" :class="rankBadgeClass(i + 1)">
                    {{ i + 1 }}
                  </span>
                  <img
                    v-if="entry.image"
                    :src="entry.image"
                    :alt="entry.username ?? ''"
                    class="w-7 h-7 rounded-full border border-zinc-700 bg-black object-cover shrink-0"
                  >
                  <div
                    v-else
                    class="w-7 h-7 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0"
                  >
                    {{ initials(entry.username) }}
                  </div>
                  <InternalEntityRef v-if="entry.user_id" :id="entry.user_id" type="user" :label="entry.username ?? entry.slack_id ?? entry.user_id" class="flex-1 min-w-0 truncate text-zinc-200" />
                  <span class="text-xs font-bold text-emerald-300 tabular-nums">{{ entry.count }}</span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-0">
          <button
            v-for="tab in (['open','claimed','resolved','closed','all'] as const)"
            :key="tab"
            class="px-4 py-2 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors"
            :class="statusFilter === tab ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'"
            @click="setStatus(tab)"
          >
            {{ tab }}
          </button>
        </div>
        <form class="flex items-center gap-2" @submit.prevent="submitSearch">
          <input
            v-model="q"
            type="search"
            placeholder="Search subject / body..."
            class="px-3 py-2 bg-black/40 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 w-64"
          >
        </form>
      </div>

      <div class="flex items-center gap-3 flex-wrap text-xs">
        <label class="flex flex-col gap-1">
          <span class="text-zinc-500">Category</span>
          <select
            v-model="categoryFilter"
            class="bg-black/40 border border-zinc-700 px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-400"
          >
            <option value="">All</option>
            <option value="project">Project</option>
            <option value="payout">Payout</option>
            <option value="account">Account</option>
            <option value="shop">Shop</option>
            <option value="bug">Bug</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-zinc-500">Priority</span>
          <select
            v-model="priorityFilter"
            class="bg-black/40 border border-zinc-700 px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-400"
          >
            <option value="">All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-zinc-500">Sort</span>
          <select
            v-model="sort"
            class="bg-black/40 border border-zinc-700 px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-400"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="updated">Recently updated</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-zinc-400 mt-5 select-none cursor-pointer">
          <input v-model="mine" type="checkbox" class="accent-white">
          <span>Mine only</span>
        </label>
      </div>

      <div v-if="loading" class="border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-500 text-sm">
        Loading...
      </div>
      <div
        v-else-if="items.length === 0"
        class="border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-500"
      >
        No tickets match the current filters.
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="t in items"
          :key="t.id"
          class="border bg-zinc-900/40 transition-colors"
          :class="expandedId === t.id ? 'border-zinc-600' : 'border-zinc-800 hover:border-zinc-600'"
        >
          <div class="flex items-center gap-4 p-4">
            <button
              type="button"
              class="flex-1 min-w-0 text-left"
              :aria-expanded="expandedId === t.id"
              :aria-controls="`ticket-preview-${t.id}`"
              @click="toggleExpand(t.id)"
            >
              <div class="flex items-center gap-2 flex-wrap">
                <ChevronRight
                  class="w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform"
                  :class="expandedId === t.id ? 'rotate-90' : ''"
                />
                <span class="text-sm font-bold text-white truncate max-w-[40ch]">
                  #{{ t.id }} {{ t.subject }}
                </span>
                <span
                  class="text-[10px] font-bold uppercase px-1.5 py-0.5 border tracking-widest"
                  :class="statusPill(t.status)"
                >
                  {{ t.status }}
                </span>
              </div>
              <div class="text-xs text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
                <span>{{ t.author_name ?? t.author_email ?? t.user_id }}</span>
                <span class="text-zinc-700">•</span>
                <span>{{ t.category }} / {{ t.priority }}</span>
                <span class="text-zinc-700">•</span>
                <span>updated {{ new Date(t.updated_at).toLocaleString() }}</span>
              </div>
            </button>
            <div class="flex items-center gap-3 text-xs shrink-0">
              <!-- Outside the toggle button: a link inside a button is invalid and unreachable by keyboard. -->
              <span v-if="t.claimed_by" class="text-zinc-500 hidden sm:inline">
                Claimed by
                <InternalEntityRef
                  :id="t.claimed_by.id"
                  type="user"
                  :label="formatReviewerHandle(t.claimed_by)"
                />
              </span>
              <span :class="ageColor(t.created_at, t.status)">{{ ageLabel(t.created_at) }}</span>
              <NuxtLink
                :to="`/internal/support/${t.id}`"
                class="p-1 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600"
                title="Open full ticket"
                aria-label="Open full ticket"
                @click.stop
              >
                <ExternalLink class="w-3.5 h-3.5" />
              </NuxtLink>
            </div>
          </div>

          <div
            v-if="expandedId === t.id"
            :id="`ticket-preview-${t.id}`"
            class="border-t border-zinc-800 bg-black/20 p-4"
          >
            <div v-if="detailLoading" class="text-xs text-zinc-500">
              Loading thread...
            </div>
            <div v-else-if="detailFailed" class="text-xs text-rose-300">
              Could not load this thread.
              <NuxtLink :to="`/internal/support/${t.id}`" class="underline">
                Open the full ticket
              </NuxtLink>
            </div>
            <div v-else-if="detail" class="flex flex-col gap-3">
              <p class="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                {{ detail.ticket.body }}
              </p>
              <div
                v-for="m in detail.messages"
                :key="m.id"
                class="border-l-2 pl-3 py-1"
                :class="m.is_internal_note ? 'border-amber-500/60' : 'border-zinc-700'"
              >
                <div class="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span class="font-bold text-zinc-400">
                    {{ m.author_name ?? (m.author_kind === "user" ? "unknown" : "Capybara") }}
                  </span>
                  <span v-if="m.is_internal_note" class="text-amber-300">internal note</span>
                  <span>{{ new Date(m.created_at).toLocaleString() }}</span>
                </div>
                <p
                  class="text-sm mt-0.5 whitespace-pre-wrap break-words"
                  :class="m.deleted_at ? 'text-zinc-600 italic' : 'text-zinc-300'"
                >
                  {{ m.deleted_at ? "(deleted)" : m.body }}
                </p>
              </div>
              <p v-if="detail.messages.length === 0" class="text-xs text-zinc-500 italic">
                No replies yet.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="total > 0"
        class="flex items-center justify-between gap-3 pt-1 text-xs text-zinc-500"
      >
        <span>
          Showing {{ Math.min((currentPage - 1) * itemsPerPage + 1, total) }} to
          {{ Math.min(currentPage * itemsPerPage, total) }} of {{ total }}
        </span>
        <InternalPagination
          :current-page="currentPage"
          :total-pages="totalPages"
          @update:current-page="onPage"
        />
      </div>
    </div>
  </div>
</template>
