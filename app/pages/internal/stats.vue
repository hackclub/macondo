<script setup lang="ts">
import type { Component } from "vue";

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

definePageMeta({ layout: "internal" });

type Bucket = {
    approvedHours: number;
    pendingHours: number;
    wipHours: number;
    totalHours: number;
};
type LevelKey = "1" | "2" | "3" | "4" | "unassigned";
type NpsTrendPoint = {
    day: string;
    responseCount: number;
    promoters: number;
    detractors: number;
};
type NpsInsights = {
    generatedForDate: string;
    windowStart: string;
    windowEnd: string;
    responseCount: number;
    ticketCount: number;
    npsScore: number | null;
    improvements: string[];
    concerns: string[];
    positives: string[];
    model: string | null;
    createdAt: string;
};
type NpsWindow = {
    score: number | null;
    avgScore: number | null;
    responseCount: number;
    promoters: number;
    passives: number;
    detractors: number;
};
type StatsResponse = {
    headlines: {
        totalUsers: number;
        dailyActiveUsers: number;
        pendingReviewHours: number;
        wipHours: number;
        approvedHours: number;
    };
    funnel: {
        signedIn: number;
        linkedHca: number;
        completedOnboarding: number;
        createdProject: number;
        logged1h: number;
        logged5h: number;
        logged10h: number;
    };
    hoursByLevel: Record<LevelKey, { software: Bucket; hardware: Bucket }>;
    hoursFunnel?: Record<
        "logged" | "pending" | "approved",
        { users: number[]; hours: number[] }
    >;
    dauByDay: { day: string; count: number }[];
    referrals: {
        referredTotal: number;
        referredQualified: number;
        totalUsers: number;
    };
    slackCoverage?: {
        channelName: string;
        channelId: string;
        totalUsers: number;
        usersWithSlackLinked: number;
        channelMembers: number | null;
        linkedAndInChannel: number | null;
        linkedNotInChannel: number | null;
        fetchError: string | null;
    };
    nps: {
        score: number | null;
        avgScore: number | null;
        responseCount: number;
        promoters: number;
        passives: number;
        detractors: number;
        thisWeek: NpsWindow;
        twoWeeks: NpsWindow;
        trend: NpsTrendPoint[];
        latestInsights: NpsInsights | null;
    };
    slackCoverage: {
        channelId: string;
        channelName: string;
        totalUsers: number;
        usersWithSlackLinked: number;
        channelMembers: number | null;
        linkedAndInChannel: number | null;
        linkedNotInChannel: number | null;
        fetchError: string | null;
    };
    generatedAt: string;
};

const LEVEL_ORDER: LevelKey[] = ["1", "2", "3", "4", "unassigned"];
const LEVEL_LABELS: Record<LevelKey, string> = {
    "1": "Level 1",
    "2": "Level 2",
    "3": "Level 3",
    "4": "Level 4",
    unassigned: "Unassigned",
};

const { data, status, refresh, error } = useFetch<StatsResponse>(
    "/api/internal/stats",
    { server: false },
);

watch(error, (newError) => {
    if (newError?.statusCode === 401 || newError?.statusCode === 403) {
        navigateTo("/?login=required");
    }
});

const now = ref(Date.now());
let nowInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    nowInterval = setInterval(() => {
        now.value = Date.now();
    }, 1000);
});
onBeforeUnmount(() => {
    if (nowInterval) clearInterval(nowInterval);
});

const lastRefreshed = computed(() => {
    if (!data.value?.generatedAt) return null;
    const diffSec = Math.max(0, Math.floor((now.value - new Date(data.value.generatedAt).getTime()) / 1000));
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
});

const isRefreshing = computed(() => status.value === "pending");

function pct(part: number, whole: number) {
    if (!whole) return "0%";
    return `${Math.round((part / whole) * 100)}%`;
}
function barWidth(part: number, whole: number) {
    if (!whole) return "0%";
    return `${Math.min(100, Math.max(0, (part / whole) * 100))}%`;
}

const dauChartData = computed(() => {
    const series = data.value?.dauByDay ?? [];
    return {
        labels: series.map((p) => p.day.slice(5)), // drop the year, show mm-dd
        datasets: [
            {
                label: "Active users",
                data: series.map((p) => p.count),
                borderColor: "#38bdf8",
                backgroundColor: "rgba(56, 189, 248, 0.15)",
                borderWidth: 2,
                pointRadius: 2.5,
                pointHoverRadius: 5,
                pointBackgroundColor: "#38bdf8",
                pointBorderColor: "#38bdf8",
                tension: 0.3,
                fill: true,
            },
        ],
    };
});

const dauChartOptions = {
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
            ticks: {
                color: "#a1a1aa",
                font: { size: 11, weight: 600 },
                precision: 0,
            },
        },
    },
};

const hasDauData = computed(() => (data.value?.dauByDay ?? []).length > 0);

const levelRows = computed(() => {
    const by = data.value?.hoursByLevel;
    if (!by) return [];
    return LEVEL_ORDER.map((key) => {
        const levelBucket = by[key] ?? {
            software: { approvedHours: 0, pendingHours: 0, wipHours: 0, totalHours: 0 },
            hardware: { approvedHours: 0, pendingHours: 0, wipHours: 0, totalHours: 0 },
        };
        return {
            key,
            label: LEVEL_LABELS[key],
            software: levelBucket.software,
            hardware: levelBucket.hardware,
        };
    }).filter((row) => {
        if (row.key !== "unassigned") return true;
        return (
            row.software.totalHours > 0 ||
            row.hardware.totalHours > 0 ||
            row.software.approvedHours > 0 ||
            row.hardware.approvedHours > 0
        );
    });
});

const npsWindow = computed(() => {
    const nps = data.value?.nps;
    if (!nps) return null;
    if (nps.thisWeek && nps.thisWeek.responseCount >= 5) { // fewer weekly responses swing the score wildly
        return { ...nps.thisWeek, label: "this week" };
    }
    if (nps.twoWeeks) {
        return { ...nps.twoWeeks, label: "past 2 weeks" };
    }
    // Older payload during a mixed deploy: fall back to the 90d aggregate.
    return {
        score: nps.score,
        avgScore: nps.avgScore,
        responseCount: nps.responseCount,
        promoters: nps.promoters,
        passives: nps.passives,
        detractors: nps.detractors,
        label: "last 90 days",
    };
});

const npsScoreBadge = computed(() => {
    const s = npsWindow.value?.score;
    if (s == null) return { label: "No data", class: "text-zinc-400 border-zinc-700 bg-zinc-800/40" };
    if (s >= 50) return { label: "Excellent", class: "text-emerald-200 border-emerald-500/40 bg-emerald-500/10" };
    if (s >= 0) return { label: "Good", class: "text-sky-200 border-sky-500/40 bg-sky-500/10" };
    if (s >= -50) return { label: "Needs work", class: "text-amber-200 border-amber-500/40 bg-amber-500/10" };
    return { label: "Critical", class: "text-red-200 border-red-500/40 bg-red-500/10" };
});

const funnelRows = computed(() => {
    const f = data.value?.funnel;
    if (!f) return [];
    return [
        { label: "Signed in", count: f.signedIn },
        { label: "Linked HCA", count: f.linkedHca },
        { label: "Completed onboarding", count: f.completedOnboarding },
        { label: "Created a project", count: f.createdProject },
        { label: "Logged ≥1h", count: f.logged1h },
        { label: "Logged ≥5h", count: f.logged5h },
        { label: "Logged ≥10h", count: f.logged10h },
    ];
});

type HoursFunnelMetric = "logged" | "pending" | "approved";
const hoursFunnelMetric = ref<HoursFunnelMetric>("logged");
const HOURS_FUNNEL_METRICS: Array<{
    key: HoursFunnelMetric;
    label: string;
    fill: string;
    active: string;
}> = [
    {
        key: "logged",
        label: "Logged",
        fill: "fill-sky-400/70",
        active: "border-sky-400 bg-sky-500/10 text-sky-200",
    },
    {
        key: "pending",
        label: "Pending review",
        fill: "fill-amber-400/70",
        active: "border-amber-400 bg-amber-500/10 text-amber-200",
    },
    {
        key: "approved",
        label: "Approved",
        fill: "fill-emerald-400/70",
        active: "border-emerald-400 bg-emerald-500/10 text-emerald-200",
    },
];
const hoursFunnelFill = computed(
    () => HOURS_FUNNEL_METRICS.find((m) => m.key === hoursFunnelMetric.value)!.fill,
);

// Stage k = users with at least 10*k hours; each segment tapers to the next stage's count.
const hoursFunnelSegments = computed(() => {
    const series = data.value?.hoursFunnel?.[hoursFunnelMetric.value];
    if (!series || !series.users.length) return [];
    const max = Math.max(...series.users, 1);
    const segW = (1100 - 16 - 10 * 2) / 11;
    const midY = 136;
    const half = (v: number) => Math.max((v / max) * 94, 3);
    return series.users.map((count, i) => {
        const x0 = 8 + i * (segW + 2);
        const x1 = x0 + segW;
        const hl = half(count);
        const hr = half(series.users[i + 1] ?? count);
        return {
            label: `${i * 10}+`,
            count,
            hours: Math.round(series.hours[i] ?? 0),
            points: `${x0},${midY - hl} ${x1},${midY - hr} ${x1},${midY + hr} ${x0},${midY + hl}`,
            cx: x0 + segW / 2,
        };
    });
});

</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="flex flex-col gap-1">
                    <h1 class="text-3xl font-bold text-white tracking-tight">Stats</h1>
                    <p class="text-zinc-400 text-sm">Program statistics and analytics.</p>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                    <span v-if="lastRefreshed" class="text-xs text-zinc-500">
                        Last refreshed {{ lastRefreshed }}
                    </span>
                    <div class="flex items-center gap-2 flex-wrap justify-end">
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
            </div>

            <div v-if="error && !data" class="border border-red-500/30 bg-red-500/10 text-red-200 p-5 text-sm">
                Failed to load stats: {{ error.message }}
            </div>

            <div v-else-if="!data && isRefreshing" class="border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400 text-sm">
                Loading stats…
            </div>

            <template v-else-if="data">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Total users</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ data.headlines.totalUsers.toLocaleString() }}
                        </span>
                    </div>
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Daily active users</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ data.headlines.dailyActiveUsers.toLocaleString() }}
                        </span>
                        <span class="text-xs text-zinc-500">activity yesterday</span>
                    </div>
                    <div class="border border-sky-500/30 bg-sky-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-sky-400/80">Work in progress</span>
                        <span class="text-3xl font-bold text-sky-200 tabular-nums">
                            {{ data.headlines.wipHours.toLocaleString() }}h
                        </span>
                        <span class="text-xs text-sky-400/60">synced hackatime hours not yet on a ship</span>
                    </div>
                    <div class="border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-amber-400/80">Pending hours to review</span>
                        <span class="text-3xl font-bold text-amber-200 tabular-nums">
                            {{ data.headlines.pendingReviewHours.toLocaleString() }}h
                        </span>
                        <span class="text-xs text-amber-400/60">hackatime hours on under-review ships</span>
                    </div>
                    <div class="border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-emerald-400/80">Approved hours</span>
                        <span class="text-3xl font-bold text-emerald-200 tabular-nums">
                            {{ data.headlines.approvedHours.toLocaleString() }}h
                        </span>
                        <span class="text-xs text-emerald-400/60">override hours on shipped ships</span>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">Daily active users</h2>
                        <span class="text-xs text-zinc-500">last 30 days, through yesterday</span>
                    </div>
                    <div v-if="hasDauData" class="w-full h-56">
                        <ClientOnly>
                            <component :is="Line" v-if="Line" :data="dauChartData" :options="dauChartOptions" />
                            <template #fallback>
                                <div class="flex items-center justify-center h-full text-sm text-zinc-500">
                                    Loading chart...
                                </div>
                            </template>
                        </ClientOnly>
                    </div>
                    <div v-else class="text-sm text-zinc-500">No activity in the last 30 days.</div>
                </div>

                <NuxtLink
                    to="/internal/nps"
                    class="group border border-pink-500/30 bg-pink-500/5 p-5 flex flex-col gap-4 no-underline hover:border-pink-400/60 hover:bg-pink-500/10 transition-colors"
                >
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">User feedback (NPS)</h2>
                            <span class="text-xs text-pink-300/70">{{ npsWindow?.label }}, one submission per user per 7 days</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <span
                                class="px-2.5 py-1 text-xs font-bold uppercase tracking-wide border"
                                :class="npsScoreBadge.class"
                            >
                                {{ npsScoreBadge.label }}
                            </span>
                        </div>
                    </div>

                    <div v-if="npsWindow" class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">NPS score</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ npsWindow.score == null ? "—" : npsWindow.score }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                {{ npsWindow.label }} · 90d: {{ data.nps.score == null ? "—" : data.nps.score }}
                            </span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Responses</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ npsWindow.responseCount.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                {{ npsWindow.label }} · 90d: {{ data.nps.responseCount.toLocaleString() }}
                            </span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Avg score</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ npsWindow.avgScore == null ? "—" : npsWindow.avgScore.toFixed(1) }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                out of 10 · 90d: {{ data.nps.avgScore == null ? "—" : data.nps.avgScore.toFixed(1) }}
                            </span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Breakdown</span>
                            <div class="flex items-baseline gap-3 text-sm font-bold tabular-nums">
                                <span class="text-emerald-300">{{ npsWindow.promoters }}P</span>
                                <span class="text-sky-300">{{ npsWindow.passives }}N</span>
                                <span class="text-red-300">{{ npsWindow.detractors }}D</span>
                            </div>
                            <span class="text-[11px] text-zinc-500">{{ npsWindow.label }} · promoters / passives / detractors</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-between gap-3 border-t border-pink-500/20 pt-3 text-xs text-pink-300/80 group-hover:text-pink-200">
                        <span>View AI insights, trend, and every submission</span>
                        <span class="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                    </div>
                </NuxtLink>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">Hours by level &amp; project type</h2>
                        <span class="text-xs text-zinc-500">
                            projects with both hardware &amp; software types are counted under hardware
                        </span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="text-xs uppercase tracking-wide text-zinc-500">
                                    <th class="py-2 px-3 font-medium text-center" rowspan="2">Level</th>
                                    <th class="py-2 px-3 font-medium text-center border-l border-zinc-800" colspan="3">Software</th>
                                    <th class="py-2 px-3 font-medium text-center border-l border-zinc-800" colspan="3">Hardware</th>
                                </tr>
                                <tr class="text-xs uppercase tracking-wide text-zinc-500">
                                    <th class="py-2 px-3 font-medium text-center border-l border-zinc-800">Approved</th>
                                    <th class="py-2 px-3 font-medium text-center">Pending</th>
                                    <th class="py-2 px-3 font-medium text-center">WIP</th>
                                    <th class="py-2 px-3 font-medium text-center border-l border-zinc-800">Approved</th>
                                    <th class="py-2 px-3 font-medium text-center">Pending</th>
                                    <th class="py-2 px-3 font-medium text-center">WIP</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in levelRows"
                                    :key="row.key"
                                    class="border-t border-zinc-800"
                                >
                                    <td class="py-2 px-3 text-center text-zinc-300">{{ row.label }}</td>
                                    <td class="py-2 px-3 text-center tabular-nums text-emerald-300 border-l border-zinc-800">
                                        {{ row.software.approvedHours.toLocaleString() }}h
                                    </td>
                                    <td class="py-2 px-3 text-center tabular-nums text-amber-300">
                                        {{ row.software.pendingHours.toLocaleString() }}h
                                    </td>
                                    <td class="py-2 px-3 text-center tabular-nums text-sky-300">
                                        {{ row.software.wipHours.toLocaleString() }}h
                                    </td>
                                    <td class="py-2 px-3 text-center tabular-nums text-emerald-300 border-l border-zinc-800">
                                        {{ row.hardware.approvedHours.toLocaleString() }}h
                                    </td>
                                    <td class="py-2 px-3 text-center tabular-nums text-amber-300">
                                        {{ row.hardware.pendingHours.toLocaleString() }}h
                                    </td>
                                    <td class="py-2 px-3 text-center tabular-nums text-sky-300">
                                        {{ row.hardware.wipHours.toLocaleString() }}h
                                    </td>
                                </tr>
                                <tr v-if="!levelRows.length">
                                    <td colspan="7" class="py-4 text-center text-zinc-500">
                                        No ship data yet.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">User funnel</h2>
                        <span class="text-xs text-zinc-500">percentage = conversion from previous stage</span>
                    </div>
                    <div class="flex flex-col gap-3">
                        <div
                            v-for="(row, idx) in funnelRows"
                            :key="row.label"
                            class="flex flex-col gap-1.5"
                        >
                            <div class="flex items-baseline justify-between gap-4">
                                <span class="text-sm text-zinc-300">{{ row.label }}</span>
                                <div class="flex items-baseline gap-3">
                                    <span class="text-sm font-bold text-white tabular-nums">
                                        {{ row.count.toLocaleString() }}
                                    </span>
                                    <span
                                        v-if="idx > 0"
                                        class="text-xs text-zinc-500 tabular-nums min-w-[2.5rem] text-right"
                                    >
                                        {{ pct(row.count, funnelRows[idx - 1].count) }}
                                    </span>
                                    <span v-else class="text-xs text-zinc-600 tabular-nums min-w-[2.5rem] text-right">
                                        —
                                    </span>
                                </div>
                            </div>
                            <div class="h-2 bg-zinc-800 w-full overflow-hidden">
                                <div
                                    class="h-full bg-sky-400/70 transition-[width] duration-300"
                                    :style="{ width: barWidth(row.count, funnelRows[0].count) }"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Hours funnel</h2>
                            <span class="text-xs text-zinc-500">
                                users with at least N hours; pending includes second-pass ships and journal hours
                            </span>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <button
                                v-for="meta in HOURS_FUNNEL_METRICS"
                                :key="meta.key"
                                type="button"
                                class="px-3 py-1.5 text-xs font-bold border"
                                :class="hoursFunnelMetric === meta.key
                                    ? meta.active
                                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'"
                                @click="hoursFunnelMetric = meta.key"
                            >
                                {{ meta.label }}
                            </button>
                        </div>
                    </div>
                    <svg
                        v-if="hoursFunnelSegments.length"
                        viewBox="0 0 1100 260"
                        class="w-full"
                        role="img"
                        aria-label="Horizontal funnel of users by minimum hours, in 10-hour steps"
                    >
                        <g v-for="seg in hoursFunnelSegments" :key="seg.label">
                            <polygon :points="seg.points" :class="hoursFunnelFill">
                                <title>{{ seg.count.toLocaleString() }} users with {{ seg.label }} hours ({{ seg.hours.toLocaleString() }}h held)</title>
                            </polygon>
                            <text
                                :x="seg.cx"
                                y="24"
                                text-anchor="middle"
                                class="fill-white text-xs font-bold tabular-nums"
                            >
                                {{ seg.count.toLocaleString() }}
                            </text>
                            <text
                                :x="seg.cx"
                                y="252"
                                text-anchor="middle"
                                class="fill-zinc-500 text-[11px] tabular-nums"
                            >
                                {{ seg.label }}
                            </text>
                        </g>
                    </svg>
                    <div v-else class="text-sm text-zinc-500">No hour data yet.</div>
                </div>

                <div
                    v-if="data.slackCoverage"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">Slack coverage</h2>
                        <span class="text-xs text-zinc-500">{{ data.slackCoverage.channelName }} ({{ data.slackCoverage.channelId }})</span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Linked Slack</span>
                            <span class="text-2xl font-bold text-white tabular-nums">
                                {{ data.slackCoverage.usersWithSlackLinked.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                of {{ data.slackCoverage.totalUsers.toLocaleString() }} website users
                                ({{ pct(data.slackCoverage.usersWithSlackLinked, data.slackCoverage.totalUsers) }})
                            </span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">In #macondo</span>
                            <span
                                class="text-2xl font-bold tabular-nums"
                                :class="data.slackCoverage.channelMembers == null ? 'text-red-300' : 'text-white'"
                            >
                                {{ data.slackCoverage.channelMembers == null ? "—" : data.slackCoverage.channelMembers.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">total channel members</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Linked &amp; in channel</span>
                            <span
                                class="text-2xl font-bold tabular-nums"
                                :class="data.slackCoverage.linkedAndInChannel == null ? 'text-red-300' : 'text-emerald-300'"
                            >
                                {{ data.slackCoverage.linkedAndInChannel == null ? "—" : data.slackCoverage.linkedAndInChannel.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">overlap of the two</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Linked, not in channel</span>
                            <span
                                class="text-2xl font-bold tabular-nums"
                                :class="data.slackCoverage.linkedNotInChannel == null ? 'text-red-300' : 'text-amber-300'"
                            >
                                {{ data.slackCoverage.linkedNotInChannel == null ? "—" : data.slackCoverage.linkedNotInChannel.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">addressable invite cohort</span>
                        </div>
                    </div>

                    <div v-if="data.slackCoverage.fetchError" class="border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-xs">
                        Slack API error: {{ data.slackCoverage.fetchError }}
                    </div>

                    <p class="text-xs text-zinc-500 leading-relaxed">
                        Hack Club Slack is not on Enterprise Grid, so users without a linked slack_id cannot be programmatically invited to the workspace itself. Users invited to #macondo are auto-added to #macondo-help by the workspace default-channels setting.
                    </p>
                </div>

                <div class="border border-violet-500/30 bg-violet-500/5 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">User-to-user referrals</h2>
                            <span class="text-xs text-violet-300/70">
                                signed up via someone's ?ref= link
                            </span>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Joined via referral</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ data.referrals.referredTotal.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">all time</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Qualified</span>
                            <span class="text-3xl font-bold text-violet-200 tabular-nums">
                                {{ data.referrals.referredQualified.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                linked HCA, past welcome · {{ pct(data.referrals.referredQualified, data.referrals.referredTotal) }} of referred
                            </span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Share of total users</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ pct(data.referrals.referredTotal, data.referrals.totalUsers) }}
                            </span>
                            <span class="text-[11px] text-zinc-500">
                                {{ data.referrals.referredTotal.toLocaleString() }} of {{ data.referrals.totalUsers.toLocaleString() }}
                            </span>
                        </div>
                    </div>
                </div>
            </template>
        </div>

    </div>
</template>
