<script setup lang="ts">
import type { Component } from "vue";

definePageMeta({ layout: "internal" });

// Lazy-load chart.js so the heavy bundle only loads on the client.
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
  );
  Line.value = vueChartjs.Line as unknown as Component;
});

type RankRow = { label: string | null; visitors: number };
type PageRow = { label: string; pageviews: number; visitors: number };
type EntryRow = { label: string; visits: number };
type TsPoint = { t: string; visitors: number; pageviews: number };
type AnalyticsResponse = {
  range: { from: string; to: string; interval: "hour" | "day" };
  topStats: {
    visitors: number;
    pageviews: number;
    visits: number;
    viewsPerVisit: number;
    bounceRate: number;
    visitDuration: number;
  };
  timeseries: TsPoint[];
  sources: RankRow[];
  utmSources: RankRow[];
  utmMediums: RankRow[];
  utmCampaigns: RankRow[];
  referrers: RankRow[];
  topPages: PageRow[];
  entryPages: EntryRow[];
  exitPages: EntryRow[];
  countries: RankRow[];
  browsers: RankRow[];
  operatingSystems: RankRow[];
  deviceTypes: RankRow[];
  screenSizes: RankRow[];
  generatedAt: string;
};
type CurrentResponse = {
  current: number;
  series: { m: string; pageviews: number }[];
  generatedAt: string;
};

// Day-aligned edges keep the API's range cache key stable;
// "today" spans under a day so the API uses hourly buckets.
type Period = "today" | "7d" | "30d" | "custom";
const period = ref<Period>("7d");

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}
const customFrom = ref(isoDay(new Date(Date.now() - 6 * 86_400_000)));
const customTo = ref(isoDay(new Date()));

const rangeQuery = computed(() => {
  const now = new Date();
  if (period.value === "today") {
    return {
      from: new Date(`${isoDay(now)}T00:00:00Z`).toISOString(),
      to: now.toISOString(),
    };
  }
  if (period.value === "custom") {
    return {
      from: new Date(`${customFrom.value}T00:00:00Z`).toISOString(),
      to: new Date(`${customTo.value}T23:59:59Z`).toISOString(),
    };
  }
  const days = period.value === "7d" ? 6 : 29;
  return {
    from: new Date(`${isoDay(new Date(Date.now() - days * 86_400_000))}T00:00:00Z`).toISOString(),
    to: new Date(`${isoDay(now)}T23:59:59Z`).toISOString(),
  };
});

const { data, status, refresh, error } = useFetch<AnalyticsResponse>(
  "/api/internal/analytics",
  { server: false, query: rangeQuery, watch: [rangeQuery] },
);

watch(error, (newError) => {
  if (newError?.statusCode === 401 || newError?.statusCode === 403) {
    navigateTo("/?login=required");
  }
});

const isRefreshing = computed(() => status.value === "pending");

const { data: current, refresh: refreshCurrent } = useFetch<CurrentResponse>(
  "/api/internal/analytics/current",
  { server: false },
);
let currentTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  currentTimer = setInterval(() => void refreshCurrent(), 15_000);
});
onBeforeUnmount(() => {
  if (currentTimer) clearInterval(currentTimer);
});

const metric = ref<"visitors" | "pageviews">("visitors");

function formatBucket(t: string, interval: "hour" | "day") {
  if (interval === "hour") return t.slice(11, 16);
  return t.slice(5);
}

const chartData = computed(() => {
  const series = data.value?.timeseries ?? [];
  const interval = data.value?.range.interval ?? "day";
  const isVisitors = metric.value === "visitors";
  const color = isVisitors ? "#38bdf8" : "#a78bfa";
  return {
    labels: series.map((p) => formatBucket(p.t, interval)),
    datasets: [
      {
        label: isVisitors ? "Visitors" : "Pageviews",
        data: series.map((p) => (isVisitors ? p.visitors : p.pageviews)),
        borderColor: color,
        backgroundColor: isVisitors
          ? "rgba(56, 189, 248, 0.15)"
          : "rgba(167, 139, 250, 0.15)",
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderColor: color,
        tension: 0.3,
        fill: true,
      },
    ],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "nearest" as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "#18181b",
      titleColor: "#fafafa",
      bodyColor: "#e4e4e7",
      borderColor: "#3f3f46",
      borderWidth: 1,
      padding: 10,
      displayColors: false,
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(63, 63, 70, 0.5)", drawTicks: false },
      border: { display: false },
      ticks: {
        color: "#a1a1aa",
        font: { size: 11, weight: 600 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 8,
      },
    },
    y: {
      beginAtZero: true,
      grid: { color: "rgba(63, 63, 70, 0.5)", drawTicks: false },
      border: { display: false },
      ticks: { color: "#a1a1aa", font: { size: 11, weight: 600 }, precision: 0 },
    },
  },
};

const hasTimeseries = computed(
  () => (data.value?.timeseries ?? []).some((p) => p.pageviews > 0),
);

function rank(rows: RankRow[] | undefined): { label: string; value: number }[] {
  return (rows ?? []).map((r) => ({ label: r.label ?? "(none)", value: r.visitors }));
}
function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function flag(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65), // letters to regional indicator symbols
  );
}

function fmtDuration(sec: number) {
  if (!sec || sec < 1) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

const sourcesTab = ref<"sources" | "referrers" | "utm_source" | "utm_medium" | "utm_campaign">("sources");
const pagesTab = ref<"top" | "entry" | "exit">("top");
const devicesTab = ref<"browser" | "os" | "device" | "screen">("browser");

const sourceTabs = [
  { key: "sources", label: "Sources" },
  { key: "referrers", label: "Referrers" },
  { key: "utm_source", label: "UTM source" },
  { key: "utm_medium", label: "UTM medium" },
  { key: "utm_campaign", label: "Campaign" },
] as const;
const pageTabs = [
  { key: "top", label: "Top pages" },
  { key: "entry", label: "Entry pages" },
  { key: "exit", label: "Exit pages" },
] as const;
const deviceTabs = [
  { key: "browser", label: "Browser" },
  { key: "os", label: "OS" },
  { key: "device", label: "Device" },
  { key: "screen", label: "Screen size" },
] as const;

const sourcesRows = computed(() => {
  const d = data.value;
  if (!d) return [];
  if (sourcesTab.value === "sources") return rank(d.sources);
  if (sourcesTab.value === "referrers") return rank(d.referrers);
  if (sourcesTab.value === "utm_source") return rank(d.utmSources);
  if (sourcesTab.value === "utm_medium") return rank(d.utmMediums);
  return rank(d.utmCampaigns);
});

const pagesRows = computed(() => {
  const d = data.value;
  if (!d) return [];
  if (pagesTab.value === "top") {
    return d.topPages.map((p) => ({ label: p.label, value: p.pageviews, secondary: p.visitors }));
  }
  return (pagesTab.value === "entry" ? d.entryPages : d.exitPages).map((p) => ({ label: p.label, value: p.visits }));
});

const devicesRows = computed(() => {
  const d = data.value;
  if (!d) return [];
  if (devicesTab.value === "browser") return rank(d.browsers);
  if (devicesTab.value === "os") return rank(d.operatingSystems);
  if (devicesTab.value === "device") {
    return d.deviceTypes.map((r) => ({ label: titleCase(r.label ?? "(none)"), value: r.visitors }));
  }
  return rank(d.screenSizes);
});

const countryRows = computed(() =>
  (data.value?.countries ?? []).map((r) => ({
    label: `${flag(r.label ?? "")} ${r.label ?? "(none)"}`.trim(),
    value: r.visitors,
  })),
);
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-6xl mx-auto flex flex-col gap-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex flex-col gap-1">
          <h1 class="text-3xl font-bold text-white tracking-tight">Analytics</h1>
          <p class="text-zinc-400 text-sm">Privacy-friendly traffic analytics for the public site.</p>
        </div>
        <div class="flex items-center gap-3 flex-wrap justify-end">
          <div class="flex items-center gap-2 px-3 py-2 border border-emerald-500/30 bg-emerald-500/5">
            <span class="relative flex h-2 w-2">
              <span class="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span class="text-sm font-bold text-emerald-200 tabular-nums">
              {{ (current?.current ?? 0).toLocaleString() }}
            </span>
            <span class="text-xs text-emerald-400/70">current</span>
          </div>
          <button
            type="button"
            :disabled="isRefreshing"
            class="px-4 py-2.5 text-sm font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="refresh()"
          >
            {{ isRefreshing ? "Refreshing…" : "Refresh" }}
          </button>
        </div>
      </div>

      <div class="flex items-end gap-3 flex-wrap">
        <div class="flex border border-zinc-800">
          <button
            v-for="opt in (['today','7d','30d','custom'] as Period[])"
            :key="opt"
            type="button"
            class="px-3 py-2 text-sm font-medium border-r border-zinc-800 last:border-r-0 transition-colors"
            :class="period === opt ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'"
            @click="period = opt"
          >
            {{ opt === 'today' ? 'Today' : opt === '7d' ? '7 days' : opt === '30d' ? '30 days' : 'Custom' }}
          </button>
        </div>
        <div v-if="period === 'custom'" class="flex items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs uppercase tracking-wide text-zinc-500">From</label>
            <input v-model="customFrom" type="date" class="bg-zinc-950 border border-zinc-800 text-zinc-200 px-2.5 py-1.5 text-sm">
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs uppercase tracking-wide text-zinc-500">To</label>
            <input v-model="customTo" type="date" class="bg-zinc-950 border border-zinc-800 text-zinc-200 px-2.5 py-1.5 text-sm">
          </div>
        </div>
      </div>

      <div v-if="error && !data" class="border border-red-500/30 bg-red-500/10 text-red-200 p-5 text-sm">
        Failed to load analytics: {{ error.message }}
      </div>
      <div v-else-if="!data && isRefreshing" class="border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400 text-sm">
        Loading analytics…
      </div>

      <template v-else-if="data">
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border border-zinc-800 bg-zinc-900/40 divide-x divide-zinc-800">
          <button
            type="button"
            class="p-5 flex flex-col gap-1 text-left transition-colors"
            :class="metric === 'visitors' ? 'bg-sky-500/10' : 'hover:bg-zinc-900'"
            @click="metric = 'visitors'"
          >
            <span class="text-xs uppercase tracking-wide" :class="metric === 'visitors' ? 'text-sky-300' : 'text-zinc-500'">Unique visitors</span>
            <span class="text-2xl font-bold tabular-nums" :class="metric === 'visitors' ? 'text-sky-200' : 'text-white'">
              {{ data.topStats.visitors.toLocaleString() }}
            </span>
          </button>
          <button
            type="button"
            class="p-5 flex flex-col gap-1 text-left transition-colors"
            :class="metric === 'pageviews' ? 'bg-violet-500/10' : 'hover:bg-zinc-900'"
            @click="metric = 'pageviews'"
          >
            <span class="text-xs uppercase tracking-wide" :class="metric === 'pageviews' ? 'text-violet-300' : 'text-zinc-500'">Total pageviews</span>
            <span class="text-2xl font-bold tabular-nums" :class="metric === 'pageviews' ? 'text-violet-200' : 'text-white'">
              {{ data.topStats.pageviews.toLocaleString() }}
            </span>
          </button>
          <div class="p-5 flex flex-col gap-1">
            <span class="text-xs uppercase tracking-wide text-zinc-500">Visits</span>
            <span class="text-2xl font-bold text-white tabular-nums">{{ data.topStats.visits.toLocaleString() }}</span>
          </div>
          <div class="p-5 flex flex-col gap-1">
            <span class="text-xs uppercase tracking-wide text-zinc-500">Views / visit</span>
            <span class="text-2xl font-bold text-white tabular-nums">{{ data.topStats.viewsPerVisit.toFixed(2) }}</span>
          </div>
          <div class="p-5 flex flex-col gap-1">
            <span class="text-xs uppercase tracking-wide text-zinc-500">Bounce rate</span>
            <span class="text-2xl font-bold text-white tabular-nums">{{ data.topStats.bounceRate }}%</span>
          </div>
          <div class="p-5 flex flex-col gap-1">
            <span class="text-xs uppercase tracking-wide text-zinc-500">Visit duration</span>
            <span class="text-2xl font-bold text-white tabular-nums">{{ fmtDuration(data.topStats.visitDuration) }}</span>
          </div>
        </div>

        <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
          <div class="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 class="text-lg font-bold text-white">{{ metric === 'visitors' ? 'Unique visitors' : 'Pageviews' }} over time</h2>
            <span class="text-xs text-zinc-500">{{ data.range.interval === 'hour' ? 'hourly' : 'daily' }} (UTC)</span>
          </div>
          <div v-if="hasTimeseries" class="w-full h-64">
            <ClientOnly>
              <component :is="Line" v-if="Line" :data="chartData" :options="chartOptions" />
              <template #fallback>
                <div class="flex items-center justify-center h-full text-sm text-zinc-500">Loading chart…</div>
              </template>
            </ClientOnly>
          </div>
          <div v-else class="text-sm text-zinc-500 py-8 text-center">No traffic in this range yet.</div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <h2 class="text-lg font-bold text-white">Sources</h2>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="tab in sourceTabs"
                  :key="tab.key"
                  type="button"
                  class="px-2 py-1 text-xs font-medium transition-colors"
                  :class="sourcesTab === tab.key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'"
                  @click="sourcesTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
            <InternalAnalyticsBarList :rows="sourcesRows" />
          </div>

          <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <h2 class="text-lg font-bold text-white">Pages</h2>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="tab in pageTabs"
                  :key="tab.key"
                  type="button"
                  class="px-2 py-1 text-xs font-medium transition-colors"
                  :class="pagesTab === tab.key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'"
                  @click="pagesTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
            <InternalAnalyticsBarList :rows="pagesRows" />
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-3">
            <h2 class="text-lg font-bold text-white">Countries</h2>
            <InternalAnalyticsBarList :rows="countryRows" empty-text="No geo data yet." />
          </div>

          <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <h2 class="text-lg font-bold text-white">Devices</h2>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="tab in deviceTabs"
                  :key="tab.key"
                  type="button"
                  class="px-2 py-1 text-xs font-medium transition-colors"
                  :class="devicesTab === tab.key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'"
                  @click="devicesTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
            <InternalAnalyticsBarList :rows="devicesRows" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
