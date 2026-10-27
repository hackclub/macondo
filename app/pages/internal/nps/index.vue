<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Component } from "vue";
import type { Chart as ChartInstance } from "chart.js";

const Line = ref<Component | null>(null);
const Bar = ref<Component | null>(null);
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
    chartJs.BarElement,
    chartJs.Filler,
    chartJs.Tooltip,
    chartJs.Title,
  );
  Line.value = vueChartjs.Line as unknown as Component;
  Bar.value = vueChartjs.Bar as unknown as Component;
});

definePageMeta({ layout: "internal" });

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
type NpsSection = {
    score: number | null;
    avgScore: number | null;
    responseCount: number;
    promoters: number;
    passives: number;
    detractors: number;
    trend: NpsTrendPoint[];
    latestInsights: NpsInsights | null;
};
// Only the nps slice of the stats response is typed, keeping this page decoupled.
type StatsResponse = {
    nps: NpsSection;
    generatedAt: string;
};

type WeeklyNpsPoint = {
    weekStart: string;
    responseCount: number;
    promoters: number;
    passives: number;
    detractors: number;
    scoreSum: number;
    nps: number | null;
    avgScore: number | null;
};
type WeeklyNpsResponse = {
    weeks: WeeklyNpsPoint[];
    generatedAt: string;
};

type Reply = {
    id: number;
    body: string;
    created_at: string;
    is_inbound: boolean;
    slack_delivered: boolean;
    slack_error: string | null;
    responder: {
        id: string;
        name: string | null;
        image: string | null;
    } | null;
};
type Submission = {
    id: number;
    score: number;
    doing_well: string;
    can_improve: string;
    anything_else: string | null;
    created_at: string;
    resolved_at: string | null;
    resolved_by: {
        id: string;
        name: string | null;
        image: string | null;
    } | null;
    user: {
        id: string;
        name: string | null;
        image: string | null;
        slack_id: string | null;
        username: string | null;
    };
    replies: Reply[];
};
type SubmissionsResponse = {
    items: Submission[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    filters: {
        bucket: "all" | "promoters" | "passives" | "detractors";
        sort: "newest" | "needs-reply";
        from: string | null;
        to: string | null;
    };
};

const { data, status, refresh, error } = useFetch<StatsResponse>(
    "/api/internal/stats",
    { server: false },
);

const {
    data: weeklyData,
    status: weeklyStatus,
    error: weeklyError,
    refresh: refreshWeekly,
} = useFetch<WeeklyNpsResponse>("/api/internal/nps/weekly", { server: false });

watch(error, (newError) => {
    if (newError?.statusCode === 401 || newError?.statusCode === 403) {
        navigateTo("/?login=required");
    }
});

const bucket = ref<"all" | "promoters" | "passives" | "detractors">("all");
const sort = ref<"newest" | "needs-reply">("newest");
const page = ref(1);
const pageSize = ref(25);

// Committed on chart pointerup so a drag doesn't refetch per mousemove.
type CommittedRange = {
    fromDay: string;
    toDay: string;
    fromIso: string;
    toIso: string;
};
const committedRange = ref<CommittedRange | null>(null);

const submissionsQuery = computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
    bucket: bucket.value,
    sort: sort.value,
    ...(committedRange.value
        ? { from: committedRange.value.fromIso, to: committedRange.value.toIso }
        : {}),
}));

const {
    data: submissionsData,
    status: submissionsStatus,
    error: submissionsError,
    refresh: refreshSubmissions,
} = useFetch<SubmissionsResponse>("/api/internal/nps/submissions", {
    server: false,
    query: submissionsQuery,
    watch: [page, pageSize, bucket, sort],
});

// Back to page 1 so the list doesn't land on an empty page past the new end.
watch(bucket, () => {
    page.value = 1;
});
watch(sort, () => {
    page.value = 1;
});
watch(committedRange, () => {
    page.value = 1;
});

const isSubmissionsLoading = computed(() => submissionsStatus.value === "pending");
const isWeeklyLoading = computed(() => weeklyStatus.value === "pending");
const isRefreshing = computed(
    () => status.value === "pending" || weeklyStatus.value === "pending",
);

async function refreshAll(): Promise<void> {
    await Promise.all([refresh(), refreshWeekly()]);
}

const npsScoreBadge = computed(() => {
    const s = data.value?.nps.score;
    if (s == null) return { label: "No data", class: "text-zinc-400 border-zinc-700 bg-zinc-800/40" };
    if (s >= 50) return { label: "Excellent", class: "text-emerald-200 border-emerald-500/40 bg-emerald-500/10" };
    if (s >= 0) return { label: "Good", class: "text-sky-200 border-sky-500/40 bg-sky-500/10" };
    if (s >= -50) return { label: "Needs work", class: "text-amber-200 border-amber-500/40 bg-amber-500/10" };
    return { label: "Critical", class: "text-red-200 border-red-500/40 bg-red-500/10" };
});

const includeToday = ref(false);

// Must match the server's EST day bucket key so trimming the trailing point compares cleanly.
function todayInEst(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const npsChartData = computed(() => {
    const all = data.value?.nps.trend ?? [];
    const today = todayInEst();
    const series = includeToday.value ? all : all.filter((p) => p.day !== today);
    return {
        labels: series.map((p) => p.day.slice(5)), // drop the year, show mm-dd
        datasets: [
            {
                label: "Responses",
                data: series.map((p) => p.responseCount),
                borderColor: "#f472b6",
                backgroundColor: "rgba(244, 114, 182, 0.15)",
                borderWidth: 2,
                pointRadius: 2.5,
                pointHoverRadius: 5,
                pointBackgroundColor: "#f472b6",
                pointBorderColor: "#f472b6",
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
            ticks: {
                color: "#a1a1aa",
                font: { size: 11, weight: 600 },
                precision: 0,
            },
        },
    },
};

const hasNpsData = computed(() => (data.value?.nps.responseCount ?? 0) > 0);

// vue-chartjs exposes the Chart.js instance as `chart`; needed to map pointer pixels to bars.
const weeklyChartRef = ref<{ chart?: ChartInstance | null } | null>(null);

const dragAnchor = ref<number | null>(null);
const isDragSelecting = ref(false);
const selStart = ref<number | null>(null);
const selEnd = ref<number | null>(null);

function weekIndexFromPointer(evt: PointerEvent): number | null {
    const chart = weeklyChartRef.value?.chart;
    const count = weeklyData.value?.weeks.length ?? 0;
    if (!chart || count === 0) return null;
    // Clamp to the plot area so drags past either edge select the first/last week.
    const x = Math.min(
        Math.max(evt.clientX - chart.canvas.getBoundingClientRect().left, chart.chartArea.left),
        chart.chartArea.right,
    );
    const raw = chart.scales.x?.getValueForPixel(x);
    if (raw == null || Number.isNaN(raw)) return null;
    return Math.min(count - 1, Math.max(0, Math.round(raw)));
}

function onWeeklyPointerDown(evt: PointerEvent): void {
    const idx = weekIndexFromPointer(evt);
    if (idx == null) return;
    isDragSelecting.value = true;
    dragAnchor.value = idx;
    selStart.value = idx;
    selEnd.value = idx;
    // Capture so the drag keeps tracking when the pointer leaves the chart.
    (evt.currentTarget as HTMLElement | null)?.setPointerCapture?.(evt.pointerId);
}

function onWeeklyPointerMove(evt: PointerEvent): void {
    if (!isDragSelecting.value || dragAnchor.value == null) return;
    const idx = weekIndexFromPointer(evt);
    if (idx == null) return;
    selStart.value = Math.min(dragAnchor.value, idx);
    selEnd.value = Math.max(dragAnchor.value, idx);
}

function onWeeklyPointerUp(evt: PointerEvent): void {
    if (!isDragSelecting.value) return;
    isDragSelecting.value = false;
    dragAnchor.value = null;
    const el = evt.currentTarget as HTMLElement | null;
    if (el?.hasPointerCapture?.(evt.pointerId)) {
        el.releasePointerCapture(evt.pointerId);
    }
    committedRange.value = rangeFromSelection();
}

function clearWeeklySelection(): void {
    isDragSelecting.value = false;
    dragAnchor.value = null;
    selStart.value = null;
    selEnd.value = null;
    committedRange.value = null;
}

// Weeks bucket in the author's timezone but the filter uses raw created_at;
// the boundary fuzz is acceptable here.
function rangeFromSelection(): CommittedRange | null {
    const weeks = weeklyData.value?.weeks ?? [];
    if (selStart.value == null || selEnd.value == null) return null;
    const slice = weeks.slice(selStart.value, selEnd.value + 1);
    if (slice.length === 0) return null;
    const first = slice[0]!;
    // Parse as UTC midnight so the math doesn't depend on the viewer's timezone.
    const endExclusive = new Date(`${slice[slice.length - 1]!.weekStart}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
    return {
        fromDay: first.weekStart,
        toDay: new Date(endExclusive.getTime() - 24 * 3600 * 1000)
            .toISOString()
            .slice(0, 10),
        fromIso: new Date(`${first.weekStart}T00:00:00Z`).toISOString(),
        toIso: new Date(endExclusive.getTime() - 1).toISOString(),
    };
}

function isWeekDimmed(idx: number): boolean {
    if (selStart.value == null || selEnd.value == null) return false;
    return idx < selStart.value || idx > selEnd.value;
}

function npsBarColor(nps: number | null, dimmed: boolean): string {
    if (nps == null) return dimmed ? "rgba(113, 113, 122, 0.15)" : "rgba(113, 113, 122, 0.4)";
    const alpha = dimmed ? 0.22 : 0.85;
    if (nps >= 50) return `rgba(52, 211, 153, ${alpha})`;
    if (nps >= 0) return `rgba(56, 189, 248, ${alpha})`;
    if (nps >= -50) return `rgba(251, 191, 36, ${alpha})`;
    return `rgba(248, 113, 113, ${alpha})`;
}

function npsToneClass(nps: number | null): string {
    if (nps == null) return "text-zinc-400 border-zinc-700 bg-zinc-800/40";
    if (nps >= 50) return "text-emerald-200 border-emerald-500/40 bg-emerald-500/10";
    if (nps >= 0) return "text-sky-200 border-sky-500/40 bg-sky-500/10";
    if (nps >= -50) return "text-amber-200 border-amber-500/40 bg-amber-500/10";
    return "text-red-200 border-red-500/40 bg-red-500/10";
}

function weekRangeLabel(weekStart: string): string {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(start)} - ${fmt(end)}`;
}

const weeklyChartData = computed(() => {
    const weeks = weeklyData.value?.weeks ?? [];
    return {
        labels: weeks.map((w) => w.weekStart.slice(5)), // drop the year, show mm-dd
        datasets: [
            {
                label: "NPS",
                data: weeks.map((w) => w.nps),
                backgroundColor: weeks.map((w, idx) => npsBarColor(w.nps, isWeekDimmed(idx))),
                borderWidth: 0,
                minBarLength: 3,
                maxBarThickness: 48,
            },
        ],
    };
});

const weeklyChartOptions = computed(() => {
    const weeks = weeklyData.value?.weeks ?? [];
    return {
        responsive: true,
        maintainAspectRatio: false,
        // Re-coloring bars on every drag tick looks janky with animation on.
        animation: false as const,
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
                callbacks: {
                    title: (items: Array<{ dataIndex: number }>) => {
                        const w = weeks[items[0]?.dataIndex ?? -1];
                        return w ? weekRangeLabel(w.weekStart) : "";
                    },
                    label: (item: { dataIndex: number }) => {
                        const w = weeks[item.dataIndex];
                        if (!w) return "";
                        return [
                            `NPS ${w.nps == null ? "n/a" : w.nps}`,
                            `${w.responseCount} response${w.responseCount === 1 ? "" : "s"}`,
                            `${w.promoters}P / ${w.passives}N / ${w.detractors}D`,
                            `avg ${w.avgScore == null ? "n/a" : w.avgScore.toFixed(1)} / 10`,
                        ];
                    },
                },
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
                    maxTicksLimit: 10,
                },
            },
            y: {
                beginAtZero: true,
                grace: "10%" as const,
                grid: {
                    // Emphasize the zero line so positive/negative weeks read at a glance.
                    color: (ctx: { tick: { value: number } }) =>
                        ctx.tick.value === 0
                            ? "rgba(161, 161, 170, 0.7)"
                            : "rgba(63, 63, 70, 0.5)",
                    drawTicks: false,
                },
                border: { display: false },
                ticks: {
                    color: "#a1a1aa",
                    font: { size: 11, weight: 600 },
                    precision: 0,
                },
            },
        },
    };
});

const weeklySelectionSummary = computed(() => {
    const weeks = weeklyData.value?.weeks ?? [];
    if (selStart.value == null || selEnd.value == null) return null;
    const slice = weeks.slice(selStart.value, selEnd.value + 1);
    if (slice.length === 0) return null;
    let responses = 0;
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let scoreSum = 0;
    for (const w of slice) {
        responses += w.responseCount;
        promoters += w.promoters;
        passives += w.passives;
        detractors += w.detractors;
        scoreSum += w.scoreSum;
    }
    const endDate = new Date(`${slice[slice.length - 1]!.weekStart}T00:00:00`);
    endDate.setDate(endDate.getDate() + 6);
    const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return {
        weekCount: slice.length,
        responses,
        promoters,
        passives,
        detractors,
        nps: responses > 0 ? Math.round(((promoters - detractors) / responses) * 100) : null,
        avgScore: responses > 0 ? scoreSum / responses : null,
        rangeLabel: `${fmt(new Date(`${slice[0]!.weekStart}T00:00:00`))} to ${fmt(endDate)}`,
    };
});

const rangeInsights = ref<NpsInsights[] | null>(null);
const selectedInsightDate = ref<string | null>(null);
const isRangeInsightsLoading = ref(false);
const rangeInsightsError = ref<string | null>(null);
let rangeInsightsRequestId = 0;

watch(committedRange, async (range) => {
    rangeInsightsError.value = null;
    if (!range) {
        rangeInsights.value = null;
        selectedInsightDate.value = null;
        return;
    }
    // Re-selections can land out of order; only the latest request writes.
    const requestId = ++rangeInsightsRequestId;
    isRangeInsightsLoading.value = true;
    try {
        const res = await $fetch<{ items: NpsInsights[] }>(
            "/api/internal/nps/insights",
            { query: { from: range.fromDay, to: range.toDay } },
        );
        if (requestId !== rangeInsightsRequestId) return;
        rangeInsights.value = res.items;
        selectedInsightDate.value = res.items[0]?.generatedForDate ?? null;
    } catch (err) {
        if (requestId !== rangeInsightsRequestId) return;
        rangeInsights.value = [];
        selectedInsightDate.value = null;
        rangeInsightsError.value =
            (err as { statusMessage?: string })?.statusMessage ||
            (err as Error)?.message ||
            "Failed to load insights for this period";
    } finally {
        if (requestId === rangeInsightsRequestId) {
            isRangeInsightsLoading.value = false;
        }
    }
});

const activeInsight = computed(() => {
    if (committedRange.value) {
        const items = rangeInsights.value ?? [];
        return (
            items.find((i) => i.generatedForDate === selectedInsightDate.value) ??
            items[0] ??
            null
        );
    }
    return data.value?.nps.latestInsights ?? null;
});

const insightsGeneratedAt = computed(() => {
    const iso = activeInsight.value?.createdAt;
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
});

const isGeneratingInsights = ref(false);
const generateInsightsError = ref<string | null>(null);

async function generateInsights(): Promise<void> {
    if (isGeneratingInsights.value) return;
    isGeneratingInsights.value = true;
    generateInsightsError.value = null;
    try {
        await $fetch("/api/internal/stats/generate-nps-insights", {
            method: "POST",
        });
        await refresh();
    } catch (err) {
        generateInsightsError.value =
            (err as { statusMessage?: string })?.statusMessage ||
            (err as Error)?.message ||
            "Failed to generate insights";
    } finally {
        isGeneratingInsights.value = false;
    }
}

function scoreClass(score: number): string {
    if (score >= 9) return "text-emerald-200 border-emerald-500/40 bg-emerald-500/10";
    if (score >= 7) return "text-sky-200 border-sky-500/40 bg-sky-500/10";
    return "text-red-200 border-red-500/40 bg-red-500/10";
}

function scoreBucket(score: number): string {
    if (score >= 9) return "Promoter";
    if (score >= 7) return "Passive";
    return "Detractor";
}

function formatDateTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function userHandle(u: Submission["user"]): string {
    return u.slack_id ?? u.username ?? (u.name ?? u.id.slice(0, 8)); // short id fallback
}

// Replies are oldest-first, so an inbound last reply means the user is awaiting ours.
function needsReply(sub: Submission): boolean {
    if (sub.resolved_at) return false;
    const last = sub.replies[sub.replies.length - 1];
    return !!last && last.is_inbound === true;
}

const resolvingIds = ref<Set<number>>(new Set());
const resolveError = ref<string | null>(null);

async function resolveSubmission(subId: number, resolved: boolean): Promise<void> {
    if (resolvingIds.value.has(subId)) return;
    resolvingIds.value = new Set([...resolvingIds.value, subId]);
    resolveError.value = null;
    try {
        await $fetch(`/api/internal/nps/submissions/${subId}/resolve`, {
            method: "POST",
            body: { resolved },
        });
        await refreshSubmissions();
    } catch (err) {
        resolveError.value =
            (err as { statusMessage?: string })?.statusMessage ||
            (err as Error)?.message ||
            "Failed to update";
    } finally {
        const next = new Set(resolvingIds.value);
        next.delete(subId);
        resolvingIds.value = next;
    }
}

function unrepliedInboundCount(sub: Submission): number {
    let count = 0;
    for (let i = sub.replies.length - 1; i >= 0; i--) {
        const r = sub.replies[i];
        if (!r) break;
        if (!r.is_inbound) break;
        count += 1;
    }
    return count;
}

const buckets: Array<{ key: "all" | "promoters" | "passives" | "detractors"; label: string; hint: string }> = [
    { key: "all", label: "All", hint: "every score" },
    { key: "promoters", label: "Promoters", hint: "9 – 10" },
    { key: "passives", label: "Passives", hint: "7 – 8" },
    { key: "detractors", label: "Detractors", hint: "1 – 6" },
];

const visiblePages = computed(() => {
    const total = submissionsData.value?.totalPages ?? 1;
    const current = page.value;
    // At most 7 page buttons, current centered, clamped to a contiguous range at the ends.
    const end = Math.min(total, Math.max(current + 3, 7));
    const pages: number[] = [];
    for (let i = Math.max(1, Math.min(current - 3, total - 6)); i <= end; i++) pages.push(i);
    return pages;
});
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="flex flex-col gap-1">
                    <h1 class="text-3xl font-bold text-white tracking-tight">NPS</h1>
                    <p class="text-zinc-400 text-sm">User feedback, AI insights, and every submission.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        :disabled="isRefreshing"
                        class="px-4 py-2.5 text-sm font-bold border border-pink-400 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        @click="refreshAll()"
                    >
                        {{ isRefreshing ? "Refreshing…" : "Refresh" }}
                    </button>
                </div>
            </div>

            <div v-if="error && !data" class="border border-red-500/30 bg-red-500/10 text-red-200 p-5 text-sm">
                Failed to load NPS: {{ error.message }}
            </div>

            <div v-else-if="!data && isRefreshing" class="border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400 text-sm">
                Loading…
            </div>

            <template v-else-if="data">
                <div class="border border-pink-500/30 bg-pink-500/5 p-5 flex flex-col gap-5">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Headline</h2>
                            <span class="text-xs text-pink-300/70">last 90 days, one submission per user per 7 days</span>
                        </div>
                        <span
                            class="px-2.5 py-1 text-xs font-bold uppercase tracking-wide border"
                            :class="npsScoreBadge.class"
                        >
                            {{ npsScoreBadge.label }}
                        </span>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">NPS score</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ data.nps.score == null ? "—" : data.nps.score }}
                            </span>
                            <span class="text-[11px] text-zinc-500">promoters - detractors</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Responses</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ data.nps.responseCount.toLocaleString() }}
                            </span>
                            <span class="text-[11px] text-zinc-500">last 90 days</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Avg score</span>
                            <span class="text-3xl font-bold text-white tabular-nums">
                                {{ data.nps.avgScore == null ? "—" : data.nps.avgScore.toFixed(1) }}
                            </span>
                            <span class="text-[11px] text-zinc-500">out of 10</span>
                        </div>
                        <div class="border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Breakdown</span>
                            <div class="flex items-baseline gap-3 text-sm font-bold tabular-nums">
                                <span class="text-emerald-300">{{ data.nps.promoters }}P</span>
                                <span class="text-sky-300">{{ data.nps.passives }}N</span>
                                <span class="text-red-300">{{ data.nps.detractors }}D</span>
                            </div>
                            <span class="text-[11px] text-zinc-500">promoters / passives / detractors</span>
                        </div>
                    </div>

                    <div>
                        <div class="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">Daily responses</span>
                            <div class="flex items-center gap-3">
                                <span class="text-[11px] text-zinc-500">last 30 days, {{ includeToday ? "through today" : "through yesterday" }}</span>
                                <label class="flex items-center gap-1.5 text-[11px] text-zinc-400 select-none cursor-pointer">
                                    <input v-model="includeToday" type="checkbox" class="accent-white">
                                    <span>Include today</span>
                                </label>
                            </div>
                        </div>
                        <div v-if="hasNpsData" class="w-full h-40">
                            <ClientOnly>
                                <component :is="Line" v-if="Line" :data="npsChartData" :options="chartOptions" />
                                <template #fallback>
                                    <div class="flex items-center justify-center h-full text-sm text-zinc-500">
                                        Loading chart...
                                    </div>
                                </template>
                            </ClientOnly>
                        </div>
                        <div v-else class="text-sm text-zinc-500">No NPS responses yet.</div>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Weekly NPS</h2>
                            <span class="text-xs text-zinc-500">
                                one bar per week since the first response · current week is partial
                            </span>
                        </div>
                        <div class="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
                            <span class="flex items-center gap-1.5">
                                <span class="w-2.5 h-2.5 inline-block bg-emerald-400/85" /> 50+
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="w-2.5 h-2.5 inline-block bg-sky-400/85" /> 0+
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="w-2.5 h-2.5 inline-block bg-amber-400/85" /> -50+
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="w-2.5 h-2.5 inline-block bg-red-400/85" /> below -50
                            </span>
                        </div>
                    </div>

                    <div
                        v-if="weeklyError"
                        class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm"
                    >
                        Failed to load weekly NPS: {{ weeklyError.message }}
                    </div>

                    <div v-else-if="!weeklyData && isWeeklyLoading" class="text-sm text-zinc-500">
                        Loading weekly NPS…
                    </div>

                    <template v-else-if="weeklyData">
                        <div
                            v-if="weeklyData.weeks.length > 0"
                            class="w-full h-56 cursor-crosshair select-none touch-none"
                            @pointerdown="onWeeklyPointerDown"
                            @pointermove="onWeeklyPointerMove"
                            @pointerup="onWeeklyPointerUp"
                            @pointercancel="onWeeklyPointerUp"
                        >
                            <ClientOnly>
                                <component
                                    :is="Bar"
                                    v-if="Bar"
                                    ref="weeklyChartRef"
                                    :data="weeklyChartData"
                                    :options="weeklyChartOptions"
                                />
                                <template #fallback>
                                    <div class="flex items-center justify-center h-full text-sm text-zinc-500">
                                        Loading chart...
                                    </div>
                                </template>
                            </ClientOnly>
                        </div>
                        <div v-else class="text-sm text-zinc-500">No NPS responses yet.</div>

                        <div
                            v-if="weeklySelectionSummary"
                            class="border border-pink-500/30 bg-pink-500/5 p-4 flex items-center gap-x-8 gap-y-3 flex-wrap"
                        >
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs uppercase tracking-wide text-zinc-500">Selected period</span>
                                <span class="text-sm font-bold text-white">{{ weeklySelectionSummary.rangeLabel }}</span>
                                <span class="text-[11px] text-zinc-500">
                                    {{ weeklySelectionSummary.weekCount }} week{{ weeklySelectionSummary.weekCount === 1 ? "" : "s" }}
                                </span>
                            </div>
                            <div class="flex flex-col gap-1">
                                <span class="text-xs uppercase tracking-wide text-zinc-500">NPS</span>
                                <span
                                    class="text-2xl font-bold tabular-nums px-2 py-0.5 border"
                                    :class="npsToneClass(weeklySelectionSummary.nps)"
                                >
                                    {{ weeklySelectionSummary.nps == null ? "n/a" : weeklySelectionSummary.nps }}
                                </span>
                            </div>
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs uppercase tracking-wide text-zinc-500">Responses</span>
                                <span class="text-2xl font-bold text-white tabular-nums">
                                    {{ weeklySelectionSummary.responses.toLocaleString() }}
                                </span>
                            </div>
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs uppercase tracking-wide text-zinc-500">Breakdown</span>
                                <div class="flex items-baseline gap-3 text-sm font-bold tabular-nums">
                                    <span class="text-emerald-300">{{ weeklySelectionSummary.promoters }}P</span>
                                    <span class="text-sky-300">{{ weeklySelectionSummary.passives }}N</span>
                                    <span class="text-red-300">{{ weeklySelectionSummary.detractors }}D</span>
                                </div>
                            </div>
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs uppercase tracking-wide text-zinc-500">Avg score</span>
                                <span class="text-2xl font-bold text-white tabular-nums">
                                    {{ weeklySelectionSummary.avgScore == null ? "n/a" : weeklySelectionSummary.avgScore.toFixed(1) }}
                                </span>
                            </div>
                            <button
                                type="button"
                                class="ml-auto px-3 py-1.5 text-xs font-bold border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                                @click="clearWeeklySelection()"
                            >
                                Clear selection
                            </button>
                        </div>
                        <div v-else-if="weeklyData.weeks.length > 0" class="text-[11px] text-zinc-500">
                            Click and drag across the chart to average NPS over a period.
                        </div>
                    </template>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">AI daily insights</h2>
                            <span v-if="committedRange" class="text-xs text-pink-300/70">
                                {{ committedRange.fromDay }} to {{ committedRange.toDay }} · following chart selection
                            </span>
                            <span v-else class="text-xs text-zinc-500">
                                synthesized from NPS + recent support tickets
                            </span>
                        </div>
                        <div v-if="committedRange" class="flex items-center gap-3">
                            <span class="text-xs text-zinc-500">
                                {{ (rangeInsights?.length ?? 0) }} insight{{ (rangeInsights?.length ?? 0) === 1 ? "" : "s" }} in period
                            </span>
                            <select
                                v-if="(rangeInsights?.length ?? 0) > 1"
                                v-model="selectedInsightDate"
                                class="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1.5 focus:outline-none focus:border-pink-400"
                            >
                                <option
                                    v-for="ins in rangeInsights"
                                    :key="ins.generatedForDate"
                                    :value="ins.generatedForDate"
                                >
                                    {{ ins.generatedForDate }}
                                </option>
                            </select>
                        </div>
                        <div v-else class="flex items-center gap-3">
                            <span v-if="insightsGeneratedAt" class="text-xs text-zinc-500">
                                Generated {{ insightsGeneratedAt }}
                            </span>
                            <button
                                type="button"
                                :disabled="isGeneratingInsights"
                                class="px-3 py-1.5 text-xs font-bold border border-pink-400 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                @click="generateInsights()"
                            >
                                {{ isGeneratingInsights ? "Generating…" : "Regenerate" }}
                            </button>
                        </div>
                    </div>

                    <div
                        v-if="generateInsightsError"
                        class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm"
                    >
                        {{ generateInsightsError }}
                    </div>

                    <div
                        v-if="rangeInsightsError"
                        class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm"
                    >
                        {{ rangeInsightsError }}
                    </div>

                    <div v-if="committedRange && isRangeInsightsLoading" class="text-sm text-zinc-500">
                        Loading insights for this period…
                    </div>

                    <template v-else-if="activeInsight">
                        <div v-if="committedRange" class="text-xs text-zinc-500">
                            Insight for {{ activeInsight.generatedForDate }} ·
                            {{ activeInsight.responseCount }} response{{ activeInsight.responseCount === 1 ? "" : "s" }} in its window{{ activeInsight.npsScore == null ? "" : ` · window NPS ${Math.round(activeInsight.npsScore)}` }}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div class="border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col gap-2">
                                <span class="text-xs uppercase tracking-wide text-amber-400/80">What to improve</span>
                                <ul v-if="activeInsight.improvements.length" class="text-sm text-zinc-200 space-y-1.5 list-disc list-outside pl-5">
                                    <li v-for="(item, idx) in activeInsight.improvements" :key="idx">{{ item }}</li>
                                </ul>
                                <span v-else class="text-sm text-zinc-500">Nothing yet.</span>
                            </div>
                            <div class="border border-red-500/30 bg-red-500/5 p-4 flex flex-col gap-2">
                                <span class="text-xs uppercase tracking-wide text-red-400/80">Concerns</span>
                                <ul v-if="activeInsight.concerns.length" class="text-sm text-zinc-200 space-y-1.5 list-disc list-outside pl-5">
                                    <li v-for="(item, idx) in activeInsight.concerns" :key="idx">{{ item }}</li>
                                </ul>
                                <span v-else class="text-sm text-zinc-500">No concerns flagged.</span>
                            </div>
                            <div class="border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-2">
                                <span class="text-xs uppercase tracking-wide text-emerald-400/80">What users love</span>
                                <ul v-if="activeInsight.positives.length" class="text-sm text-zinc-200 space-y-1.5 list-disc list-outside pl-5">
                                    <li v-for="(item, idx) in activeInsight.positives" :key="idx">{{ item }}</li>
                                </ul>
                                <span v-else class="text-sm text-zinc-500">Nothing yet.</span>
                            </div>
                        </div>
                    </template>
                    <div v-else-if="committedRange" class="text-sm text-zinc-500">
                        No AI insights were generated in this period.
                    </div>
                    <div v-else class="text-sm text-zinc-500">
                        No insights yet. Click Regenerate to run the daily AI summary.
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">All submissions</h2>
                            <span v-if="committedRange" class="text-xs text-pink-300/70">
                                {{ submissionsData?.total?.toLocaleString() ?? "—" }} in {{ committedRange.fromDay }} to {{ committedRange.toDay }} · following chart selection · {{ sort === "needs-reply" ? "needs reply first" : "newest first" }}
                            </span>
                            <span v-else class="text-xs text-zinc-500">
                                {{ submissionsData?.total?.toLocaleString() ?? "—" }} total · {{ sort === "needs-reply" ? "needs reply first" : "newest first" }}
                            </span>
                        </div>
                        <div class="flex items-center gap-3 flex-wrap">
                            <div class="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors"
                                    :class="sort === 'newest'
                                        ? 'border-pink-400 bg-pink-500/10 text-pink-200'
                                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-500'"
                                    title="Sort by submission date, newest first"
                                    @click="sort = 'newest'"
                                >
                                    Newest
                                </button>
                                <button
                                    type="button"
                                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors"
                                    :class="sort === 'needs-reply'
                                        ? 'border-amber-400 bg-amber-500/10 text-amber-100'
                                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-500'"
                                    title="Show needs-reply rows first"
                                    @click="sort = 'needs-reply'"
                                >
                                    Needs reply
                                </button>
                            </div>
                            <span class="w-px h-5 bg-zinc-800" />
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <button
                                    v-for="b in buckets"
                                    :key="b.key"
                                    type="button"
                                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors"
                                    :class="bucket === b.key
                                        ? 'border-pink-400 bg-pink-500/10 text-pink-200'
                                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-500'"
                                    :title="b.hint"
                                    @click="bucket = b.key"
                                >
                                    {{ b.label }}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="resolveError"
                        class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm"
                    >
                        {{ resolveError }}
                    </div>

                    <div
                        v-if="submissionsError"
                        class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm"
                    >
                        Failed to load submissions: {{ submissionsError.message }}
                    </div>

                    <div v-if="isSubmissionsLoading && !submissionsData" class="text-sm text-zinc-500">
                        Loading submissions…
                    </div>

                    <div v-else-if="(submissionsData?.items.length ?? 0) === 0" class="text-sm text-zinc-500">
                        No submissions match this filter.
                    </div>

                    <ul v-else class="flex flex-col divide-y divide-zinc-800 list-none m-0 p-0">
                        <li
                            v-for="sub in submissionsData?.items"
                            :key="sub.id"
                            class="py-4 flex gap-4 transition-colors"
                            :class="needsReply(sub)
                                ? 'border-l-4 border-l-amber-400 pl-4 -ml-4 bg-amber-500/5'
                                : ''"
                        >
                            <div class="shrink-0">
                                <NuxtLink
                                    :to="`/internal/users/${sub.user.id}`"
                                    class="block"
                                >
                                    <img
                                        v-if="sub.user.image"
                                        :src="sub.user.image"
                                        :alt="sub.user.name ?? ''"
                                        class="w-10 h-10 rounded-full border border-zinc-700 bg-black object-cover"
                                    >
                                    <div
                                        v-else
                                        class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white bg-black border border-zinc-700"
                                    >
                                        {{ (sub.user.name ?? "?").charAt(0).toUpperCase() }}
                                    </div>
                                </NuxtLink>
                            </div>
                            <div class="flex-1 min-w-0 flex flex-col gap-2">
                                <div class="flex items-baseline gap-3 flex-wrap">
                                    <NuxtLink
                                        :to="`/internal/users/${sub.user.id}`"
                                        class="text-sm font-semibold text-white hover:text-pink-200 transition-colors"
                                    >
                                        {{ sub.user.name || userHandle(sub.user) }}
                                    </NuxtLink>
                                    <span class="text-[10px] text-zinc-500 font-mono tracking-tight truncate">
                                        {{ userHandle(sub.user) }}
                                    </span>
                                    <span
                                        class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border"
                                        :class="scoreClass(sub.score)"
                                    >
                                        {{ sub.score }}/10 · {{ scoreBucket(sub.score) }}
                                    </span>
                                    <NuxtLink
                                        :to="`/internal/nps/${sub.id}`"
                                        class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border transition-colors border-pink-400 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20"
                                    >
                                        Open{{ sub.replies.length > 0 ? ` · ${sub.replies.length}` : "" }}
                                    </NuxtLink>
                                    <span
                                        v-if="needsReply(sub)"
                                        class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-amber-400 bg-amber-500/20 text-amber-100 animate-pulse"
                                        :title="`User sent ${unrepliedInboundCount(sub)} unanswered message${unrepliedInboundCount(sub) === 1 ? '' : 's'}`"
                                    >
                                        ↩ Needs reply{{ unrepliedInboundCount(sub) > 1 ? ` · ${unrepliedInboundCount(sub)} new` : '' }}
                                    </span>
                                    <button
                                        v-if="needsReply(sub)"
                                        type="button"
                                        :disabled="resolvingIds.has(sub.id)"
                                        class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-emerald-400 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Mark this thread as handled so it stops appearing in the needs-reply list"
                                        @click="resolveSubmission(sub.id, true)"
                                    >
                                        {{ resolvingIds.has(sub.id) ? "…" : "✓ Resolve" }}
                                    </button>
                                    <span
                                        v-if="sub.resolved_at"
                                        class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                        :title="sub.resolved_by?.name ? `Resolved by ${sub.resolved_by.name}` : 'Resolved'"
                                    >
                                        ✓ Resolved
                                    </span>
                                    <span class="ml-auto text-[11px] text-zinc-500 whitespace-nowrap">
                                        {{ formatDateTime(sub.created_at) }}
                                    </span>
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div class="border border-emerald-500/20 bg-emerald-500/5 p-3">
                                        <div class="text-[10px] font-bold uppercase tracking-wide text-emerald-400/80 mb-1.5">
                                            Doing well
                                        </div>
                                        <p class="text-sm text-zinc-200 whitespace-pre-wrap m-0">
                                            <InternalLinkifyText :text="sub.doing_well" />
                                        </p>
                                    </div>
                                    <div class="border border-amber-500/20 bg-amber-500/5 p-3">
                                        <div class="text-[10px] font-bold uppercase tracking-wide text-amber-400/80 mb-1.5">
                                            Can improve
                                        </div>
                                        <p class="text-sm text-zinc-200 whitespace-pre-wrap m-0">
                                            <InternalLinkifyText :text="sub.can_improve" />
                                        </p>
                                    </div>
                                </div>
                                <div v-if="sub.anything_else" class="border border-zinc-800 bg-zinc-950/60 p-3">
                                    <div class="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1.5">
                                        Anything else
                                    </div>
                                    <p class="text-sm text-zinc-300 whitespace-pre-wrap m-0">
                                        <InternalLinkifyText :text="sub.anything_else" />
                                    </p>
                                </div>
                            </div>
                        </li>
                    </ul>

                    <div
                        v-if="submissionsData && submissionsData.totalPages > 1"
                        class="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-zinc-800"
                    >
                        <span class="text-xs text-zinc-500">
                            Page {{ submissionsData.page }} of {{ submissionsData.totalPages }}
                        </span>
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                :disabled="page <= 1 || isSubmissionsLoading"
                                class="px-3 py-1.5 text-xs font-bold border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                @click="page = Math.max(1, page - 1)"
                            >
                                Prev
                            </button>
                            <button
                                v-for="p in visiblePages"
                                :key="p"
                                type="button"
                                :disabled="isSubmissionsLoading"
                                class="w-8 h-8 text-xs font-bold border transition-colors"
                                :class="p === page
                                    ? 'border-pink-400 bg-pink-500/10 text-pink-200'
                                    : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'"
                                @click="page = p"
                            >
                                {{ p }}
                            </button>
                            <button
                                type="button"
                                :disabled="page >= (submissionsData?.totalPages ?? 1) || isSubmissionsLoading"
                                class="px-3 py-1.5 text-xs font-bold border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                @click="page = Math.min(submissionsData?.totalPages ?? 1, page + 1)"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
