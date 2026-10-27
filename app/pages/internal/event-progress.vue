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

type DailyPoint = { day: string; qualified: number; cumulative: number };
type BreakdownRow = { label: string; count: number };
type HoursBand = { label: string; min: number; max: number | null; count: number };
type IntentKey = "yes" | "no" | "unanswered";
type UnlockCandidate = {
    userId: string;
    name: string | null;
    username: string | null;
    email: string | null;
    approvedHours: number;
    pendingHours: number;
    projectedHours: number;
    intent: IntentKey;
};
type IntentSlice = {
    intent: IntentKey;
    qualified: number;
    granted: number;
    bought: number;
    certificatesClaimed: number;
    countriesRepresented: number;
    atHoursBar: number;
    grantGap: number;
    makersWithWorkInReview: number;
    reviewBacklogHours: number;
    unlockedByReview: number;
    canAffordNow: number;
    reachableNow: number;
};

type EventProgressResponse = {
    goal: number;
    qualifyHours: number;
    qualificationDeadline: string;
    eventStart: string;
    generatedAt: string;
    qualified: number;
    granted: number;
    bought: number;
    remainingToGoal: number;
    qualifiedLast24h: number;
    qualifiedLast7d: number;
    qualifiedPrev7d: number;
    daily: DailyPoint[];
    atHoursBar: number;
    grantGap: number;
    hoursBands: HoursBand[];
    makersWithWorkInReview: number;
    reviewBacklogHours: number;
    unlockedByReview: number;
    unlockedByReviewList: UnlockCandidate[];
    unlockedByReviewListTruncated: boolean;
    invitePriceGold: number | null;
    canAffordNow: number;
    affordBands: BreakdownRow[];
    reachableNow: number;
    byIntent: IntentSlice[];
    certificatesClaimed: number;
    topCountries: BreakdownRow[];
    countriesRepresented: number;
};

const { data, status, refresh, error } = useFetch<EventProgressResponse>(
    "/api/internal/event-progress",
    { server: false },
);

watch(error, (newError) => {
    if (newError?.statusCode === 401 || newError?.statusCode === 403) {
        navigateTo("/?login=required");
    }
});

const isRefreshing = computed(() => status.value === "pending");

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

const DAY_MS = 86_400_000;

function countdownParts(target: string | undefined) {
    if (!target) return null;
    const remaining = Math.max(new Date(target).getTime() - now.value, 0);
    return {
        done: remaining === 0,
        days: Math.floor(remaining / DAY_MS),
        hours: Math.floor(remaining / 3_600_000) % 24,
        minutes: Math.floor(remaining / 60_000) % 60,
        seconds: Math.floor(remaining / 1000) % 60,
    };
}

const deadlineCountdown = computed(() =>
    countdownParts(data.value?.qualificationDeadline),
);
const eventCountdown = computed(() => countdownParts(data.value?.eventStart));

const easternStamp = (iso: string | undefined) =>
    iso
        ? new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              dateStyle: "medium",
              timeStyle: "short",
          }).format(new Date(iso))
        : "";

// Pace depends on the clock, so it's computed from `now`, not the payload.
const pace = computed(() => {
    const d = data.value;
    if (!d) return null;
    const daysLeft = Math.max(new Date(d.qualificationDeadline).getTime() - now.value, 0) / DAY_MS;
    const currentPerDay = d.qualifiedLast7d / 7;
    const projected = Math.round(d.qualified + currentPerDay * daysLeft);
    return {
        daysLeft,
        currentPerDay,
        requiredPerDay: daysLeft === 0 ? d.remainingToGoal : d.remainingToGoal / daysLeft,
        projected,
        onTrack: projected >= d.goal,
    };
});

const goalPercent = computed(() => {
    const d = data.value;
    if (!d) return 0;
    return Math.min((d.qualified / d.goal) * 100, 100);
});

const weekOverWeek = computed(() => {
    const d = data.value;
    if (!d || d.qualifiedPrev7d === 0) return null;
    return ((d.qualifiedLast7d - d.qualifiedPrev7d) / d.qualifiedPrev7d) * 100;
});

const maxBand = computed(() =>
    Math.max(1, ...(data.value?.hoursBands ?? []).map((b) => b.count)),
);
const maxCountry = computed(() =>
    Math.max(1, ...(data.value?.topCountries ?? []).map((c) => c.count)),
);
const maxAfford = computed(() =>
    Math.max(1, ...(data.value?.affordBands ?? []).map((b) => b.count)),
);

const INTENT_LABELS: Record<IntentKey, string> = {
    yes: "Yes",
    no: "No",
    unanswered: "Unanswered",
};

// nonAdditive rows must NOT be summed: a country can appear under yes, no and unanswered,
// so the total is a distinct count from the server.
const INTENT_ROWS: {
    key: keyof Omit<IntentSlice, "intent">;
    label: string;
    suffix?: string;
    nonAdditive?: boolean;
}[] = [
    { key: "qualified", label: "Holds a seat" },
    { key: "granted", label: "— granted at the hours bar" },
    { key: "bought", label: "— bought with gold" },
    { key: "certificatesClaimed", label: "Certificates claimed" },
    { key: "countriesRepresented", label: "Countries represented", nonAdditive: true },
    { key: "atHoursBar", label: "At the hours bar" },
    { key: "grantGap", label: "Grant gap (at bar, no seat)" },
    { key: "makersWithWorkInReview", label: "Seatless, work in review" },
    { key: "reviewBacklogHours", label: "Unreviewed hours", suffix: "h" },
    { key: "unlockedByReview", label: "Would qualify once reviewed" },
    { key: "canAffordNow", label: "Could buy a seat now" },
    { key: "reachableNow", label: "Reachable right now" },
];

const intentTotal = (key: keyof Omit<IntentSlice, "intent">) =>
    (data.value?.byIntent ?? []).reduce((sum, s) => sum + (s[key] ?? 0), 0);

const hasTrend = computed(() => (data.value?.daily.length ?? 0) > 1);

const trendChartData = computed(() => {
    const d = data.value;
    if (!d) return { labels: [], datasets: [] };
    const labels = d.daily.map((p) =>
        new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
        }).format(new Date(`${p.day}T00:00:00Z`)),
    );
    // Straight line from the opening total to the goal at the deadline; below it means behind.
    const start = d.daily[0]?.cumulative ?? 0;
    const span = d.daily.length - 1 || 1;
    const firstTs = new Date(`${d.daily[0]?.day}T00:00:00Z`).getTime();
    const totalSpanDays = Math.max((new Date(d.qualificationDeadline).getTime() - firstTs) / DAY_MS, 1);
    const shownDays = Math.max((new Date(`${d.daily[span]?.day}T00:00:00Z`).getTime() - firstTs) / DAY_MS, 1);

    return {
        labels,
        datasets: [
            {
                label: "Qualified",
                data: d.daily.map((p) => p.cumulative),
                borderColor: "#34d399",
                backgroundColor: "rgba(52, 211, 153, 0.12)",
                fill: true,
                tension: 0.25,
                pointRadius: 0,
                borderWidth: 2,
            },
            {
                label: "Pace to goal",
                data: d.daily.map(
                    (_, i) =>
                        start +
                        ((d.goal - start) * ((i / span) * shownDays)) / totalSpanDays,
                ),
                borderColor: "#71717a",
                borderDash: [5, 4],
                fill: false,
                pointRadius: 0,
                borderWidth: 2,
            },
        ],
    };
});

const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" as const },
    plugins: { legend: { display: false } },
    scales: {
        x: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#71717a", maxTicksLimit: 8 },
        },
        y: {
            beginAtZero: true,
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#71717a" },
        },
    },
};
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="flex flex-col gap-1">
                    <h1 class="text-3xl font-bold text-white tracking-tight">Event progress</h1>
                    <p class="text-zinc-400 text-sm">
                        Qualification and seat tracking for the in-person event.
                    </p>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                    <span v-if="data" class="text-xs text-zinc-500">
                        Data as of {{ easternStamp(data.generatedAt) }} ET
                    </span>
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

            <div
                v-if="error && !data"
                class="border border-red-500/30 bg-red-500/10 text-red-200 p-5 text-sm"
            >
                Failed to load event progress: {{ error.message }}
            </div>

            <div
                v-else-if="!data && isRefreshing"
                class="border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400 text-sm"
            >
                Loading event progress…
            </div>

            <template v-else-if="data">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div class="border border-red-500/30 bg-red-500/5 p-5 flex flex-col gap-3">
                        <div class="flex items-baseline justify-between gap-3 flex-wrap">
                            <span class="text-xs uppercase tracking-wide text-red-400/80">
                                Qualification closes
                            </span>
                            <span class="text-xs text-zinc-500">
                                {{ easternStamp(data.qualificationDeadline) }} ET
                            </span>
                        </div>
                        <div v-if="deadlineCountdown?.done" class="text-3xl font-bold text-red-200">
                            Qualification closed
                        </div>
                        <div v-else-if="deadlineCountdown" class="grid grid-cols-4 gap-2">
                            <div
                                v-for="part in [
                                    { v: deadlineCountdown.days, u: 'days' },
                                    { v: deadlineCountdown.hours, u: 'hrs' },
                                    { v: deadlineCountdown.minutes, u: 'min' },
                                    { v: deadlineCountdown.seconds, u: 'sec' },
                                ]"
                                :key="part.u"
                                class="bg-zinc-900/60 py-3 text-center"
                            >
                                <div class="text-2xl font-bold text-red-200 tabular-nums">
                                    {{ String(part.v).padStart(2, "0") }}
                                </div>
                                <div class="text-[10px] uppercase tracking-wider text-zinc-500">
                                    {{ part.u }}
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-red-400/60">
                            Aug 9 is the last qualifying day, the window shuts at midnight ET that night.
                        </p>
                    </div>

                    <div class="border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-col gap-3">
                        <div class="flex items-baseline justify-between gap-3 flex-wrap">
                            <span class="text-xs uppercase tracking-wide text-emerald-400/80">
                                Event starts
                            </span>
                            <span class="text-xs text-zinc-500">
                                {{ easternStamp(data.eventStart) }} ET
                            </span>
                        </div>
                        <div v-if="eventCountdown?.done" class="text-3xl font-bold text-emerald-200">
                            Event underway
                        </div>
                        <div v-else-if="eventCountdown" class="grid grid-cols-4 gap-2">
                            <div
                                v-for="part in [
                                    { v: eventCountdown.days, u: 'days' },
                                    { v: eventCountdown.hours, u: 'hrs' },
                                    { v: eventCountdown.minutes, u: 'min' },
                                    { v: eventCountdown.seconds, u: 'sec' },
                                ]"
                                :key="part.u"
                                class="bg-zinc-900/60 py-3 text-center"
                            >
                                <div class="text-2xl font-bold text-emerald-200 tabular-nums">
                                    {{ String(part.v).padStart(2, "0") }}
                                </div>
                                <div class="text-[10px] uppercase tracking-wider text-zinc-500">
                                    {{ part.u }}
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-emerald-400/60">
                            Doors open at noon ET, one week after qualification closes.
                        </p>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-end justify-between gap-4 flex-wrap">
                        <div class="flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">
                                Qualified for the event
                            </span>
                            <div class="flex items-baseline gap-2">
                                <span class="text-5xl font-bold text-white tabular-nums">
                                    {{ data.qualified.toLocaleString() }}
                                </span>
                                <span class="text-2xl font-bold text-zinc-600">
                                    / {{ data.goal }}
                                </span>
                            </div>
                            <span class="text-xs text-zinc-500">
                                {{ data.granted.toLocaleString() }} granted at
                                {{ data.qualifyHours }}h ·
                                {{ data.bought.toLocaleString() }} bought with gold
                            </span>
                        </div>
                        <div class="flex flex-col items-end gap-1">
                            <span class="text-3xl font-bold text-emerald-200 tabular-nums">
                                {{ goalPercent.toFixed(1) }}%
                            </span>
                            <span class="text-xs text-zinc-500">
                                {{ data.remainingToGoal.toLocaleString() }} seats left to fill
                            </span>
                        </div>
                    </div>

                    <div class="h-4 w-full bg-zinc-800">
                        <div
                            class="h-full transition-all duration-500"
                            :class="pace?.onTrack ? 'bg-emerald-400' : 'bg-amber-400'"
                            :style="{ width: `${goalPercent}%` }"
                        />
                    </div>

                    <p v-if="pace" class="text-sm" :class="pace.onTrack ? 'text-emerald-300' : 'text-amber-300'">
                        <span class="font-bold">{{ pace.onTrack ? "On track" : "Behind pace" }}</span>
                        — projecting
                        <span class="font-bold tabular-nums">{{ pace.projected.toLocaleString() }}</span>
                        seats filled by the deadline
                        ({{ pace.projected >= data.goal ? "+" : "" }}{{ pace.projected - data.goal }}
                        vs. goal).
                    </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Needed per day</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ pace ? pace.requiredPerDay.toFixed(1) : "—" }}
                        </span>
                        <span class="text-xs text-zinc-500">
                            {{ data.remainingToGoal }} seats over
                            {{ pace ? pace.daysLeft.toFixed(1) : "—" }} days
                        </span>
                    </div>
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Current pace</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ pace ? pace.currentPerDay.toFixed(1) : "—" }}/day
                        </span>
                        <span class="text-xs text-zinc-500">
                            {{ data.qualifiedLast7d }} this week
                            <span
                                v-if="weekOverWeek !== null"
                                :class="weekOverWeek >= 0 ? 'text-emerald-400' : 'text-red-400'"
                            >
                                ({{ weekOverWeek >= 0 ? "+" : "" }}{{ weekOverWeek.toFixed(0) }}% WoW)
                            </span>
                        </span>
                    </div>
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Qualified last 24h</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ data.qualifiedLast24h.toLocaleString() }}
                        </span>
                        <span class="text-xs text-zinc-500">
                            {{ data.countriesRepresented }} countries represented
                        </span>
                    </div>
                    <div
                        class="border p-5 flex flex-col gap-1"
                        :class="
                            data.grantGap > 0
                                ? 'border-red-500/30 bg-red-500/5'
                                : 'border-zinc-800 bg-zinc-900/40'
                        "
                    >
                        <span
                            class="text-xs uppercase tracking-wide"
                            :class="data.grantGap > 0 ? 'text-red-400/80' : 'text-zinc-500'"
                        >
                            Grant gap
                        </span>
                        <span
                            class="text-3xl font-bold tabular-nums"
                            :class="data.grantGap > 0 ? 'text-red-200' : 'text-white'"
                        >
                            {{ data.grantGap.toLocaleString() }}
                        </span>
                        <span
                            class="text-xs"
                            :class="data.grantGap > 0 ? 'text-red-400/60' : 'text-zinc-500'"
                        >
                            at {{ data.qualifyHours }}h+ with no invite — run the auto-qualify sweep
                        </span>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-emerald-400/80">
                            Have the hours
                        </span>
                        <span class="text-3xl font-bold text-emerald-200 tabular-nums">
                            {{ data.atHoursBar.toLocaleString() }}
                        </span>
                        <span class="text-xs text-emerald-400/60">
                            makers at {{ data.qualifyHours }}h+ approved, seat or not
                        </span>
                    </div>
                    <div class="border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-amber-400/80">
                            Can buy a seat now
                        </span>
                        <span class="text-3xl font-bold text-amber-200 tabular-nums">
                            {{ data.canAffordNow.toLocaleString() }}
                        </span>
                        <span class="text-xs text-amber-400/60">
                            seatless makers holding
                            {{ data.invitePriceGold?.toLocaleString() ?? "—" }}+ gold
                        </span>
                    </div>
                    <div class="border border-sky-500/30 bg-sky-500/5 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-sky-400/80">
                            Reachable right now
                        </span>
                        <span class="text-3xl font-bold text-sky-200 tabular-nums">
                            {{ data.reachableNow.toLocaleString() }}
                        </span>
                        <span class="text-xs text-sky-400/60">
                            could take a seat today by hours or gold (deduped)
                        </span>
                    </div>
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-zinc-500">Invite price</span>
                        <span class="text-3xl font-bold text-white tabular-nums">
                            {{ data.invitePriceGold?.toLocaleString() ?? "—" }}
                            <span class="text-lg text-zinc-600">gold</span>
                        </span>
                        <span class="text-xs text-zinc-500">
                            or free at {{ data.qualifyHours }} approved hours
                        </span>
                    </div>
                </div>

                <div class="border border-violet-500/30 bg-violet-500/5 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">Blocked by the review queue</h2>
                        <span class="text-xs text-zinc-500">
                            seatless makers whose queued work would carry them over
                            {{ data.qualifyHours }}h
                        </span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-violet-400/80">
                                Would qualify
                            </span>
                            <span class="text-4xl font-bold text-violet-200 tabular-nums">
                                {{ data.unlockedByReview.toLocaleString() }}
                            </span>
                            <span class="text-xs text-violet-400/60">
                                short of {{ data.qualifyHours }}h today, over it once their
                                submitted hours are reviewed
                            </span>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">
                                Unreviewed hours
                            </span>
                            <span class="text-4xl font-bold text-white tabular-nums">
                                {{ data.reviewBacklogHours.toLocaleString() }}h
                            </span>
                            <span class="text-xs text-zinc-500">
                                submitted, awaiting a reviewer decision
                            </span>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="text-xs uppercase tracking-wide text-zinc-500">
                                Makers waiting
                            </span>
                            <span class="text-4xl font-bold text-white tabular-nums">
                                {{ data.makersWithWorkInReview.toLocaleString() }}
                            </span>
                            <span class="text-xs text-zinc-500">
                                seatless makers with work sitting in the queue
                            </span>
                        </div>
                    </div>

                    <p class="text-sm text-zinc-400">
                        <template v-if="data.unlockedByReview > 0">
                            Clearing the queue would take qualifiers from
                            <span class="font-bold tabular-nums text-white">{{ data.qualified }}</span>
                            to
                            <span class="font-bold tabular-nums text-violet-200">
                                {{ data.qualified + data.unlockedByReview }}
                            </span>
                            of {{ data.goal }} — review throughput, not demand, is the constraint.
                        </template>
                        <template v-else>
                            Nobody in the review queue is close enough to cross
                            {{ data.qualifyHours }}h, so the shortfall is a demand problem rather
                            than a review-throughput one.
                        </template>
                    </p>

                    <div v-if="data.unlockedByReviewList.length" class="flex flex-col gap-2">
                        <div class="flex items-baseline justify-between gap-3 flex-wrap">
                            <h3 class="text-sm font-bold text-white">
                                Who they are
                            </h3>
                            <span class="text-xs text-zinc-500">
                                closest to the bar first
                                <template v-if="data.unlockedByReviewListTruncated">
                                    · showing the first
                                    {{ data.unlockedByReviewList.length.toLocaleString() }} of
                                    {{ data.unlockedByReview.toLocaleString() }}
                                </template>
                            </span>
                        </div>

                        <div class="max-h-96 overflow-y-auto border border-zinc-800">
                            <table class="w-full text-sm border-collapse">
                                <thead class="sticky top-0 bg-zinc-900">
                                    <tr class="border-b border-zinc-800">
                                        <th class="text-left font-medium text-zinc-500 py-2 px-3">Maker</th>
                                        <th class="text-right font-medium text-zinc-500 py-2 px-3">Approved</th>
                                        <th class="text-right font-medium text-zinc-500 py-2 px-3">In review</th>
                                        <th class="text-right font-medium text-zinc-500 py-2 px-3">Projected</th>
                                        <th class="text-right font-medium text-zinc-500 py-2 px-3">Coming?</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="person in data.unlockedByReviewList"
                                        :key="person.userId"
                                        class="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/60"
                                    >
                                        <td class="py-2 px-3">
                                            <NuxtLink
                                                :to="`/internal/users/${person.userId}`"
                                                class="text-amber-300 hover:text-amber-200 hover:underline underline-offset-2 transition-colors"
                                            >
                                                {{ person.username || person.name || person.email || person.userId }}
                                            </NuxtLink>
                                            <span
                                                v-if="person.email && (person.username || person.name)"
                                                class="block text-xs text-zinc-500"
                                            >
                                                {{ person.email }}
                                            </span>
                                        </td>
                                        <td class="text-right tabular-nums py-2 px-3 text-zinc-400">
                                            {{ person.approvedHours }}h
                                        </td>
                                        <td class="text-right tabular-nums py-2 px-3 text-violet-200">
                                            {{ person.pendingHours }}h
                                        </td>
                                        <td class="text-right tabular-nums py-2 px-3 font-bold text-white">
                                            {{ person.projectedHours }}h
                                        </td>
                                        <td
                                            class="text-right py-2 px-3"
                                            :class="{
                                                'text-emerald-300': person.intent === 'yes',
                                                'text-red-300': person.intent === 'no',
                                                'text-zinc-600': person.intent === 'unanswered',
                                            }"
                                        >
                                            {{ INTENT_LABELS[person.intent] }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex items-baseline justify-between gap-4 flex-wrap">
                        <h2 class="text-lg font-bold text-white">Seats filled vs. pace</h2>
                        <span class="text-xs text-zinc-500">
                            cumulative, against a straight line to {{ data.goal }} by the deadline
                        </span>
                    </div>
                    <div v-if="hasTrend" class="w-full h-64">
                        <ClientOnly>
                            <component
                                :is="Line"
                                v-if="Line"
                                :data="trendChartData"
                                :options="trendChartOptions"
                            />
                            <template #fallback>
                                <div class="flex items-center justify-center h-full text-sm text-zinc-500">
                                    Loading chart...
                                </div>
                            </template>
                        </ClientOnly>
                    </div>
                    <div v-else class="text-sm text-zinc-500">Not enough history yet.</div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Who's still convertible</h2>
                            <p class="text-xs text-zinc-500">
                                Makers without a seat, by approved hours. The top band is the
                                cheapest pool to convert.
                            </p>
                        </div>
                        <div class="flex flex-col gap-3">
                            <div
                                v-for="band in data.hoursBands"
                                :key="band.label"
                                class="flex flex-col gap-1.5"
                            >
                                <div class="flex items-baseline justify-between text-sm">
                                    <span class="text-zinc-300">{{ band.label }}</span>
                                    <span class="text-zinc-400 tabular-nums">
                                        {{ band.count.toLocaleString() }}
                                    </span>
                                </div>
                                <div class="h-2 w-full bg-zinc-800">
                                    <div
                                        class="h-full bg-sky-400/70"
                                        :style="{ width: `${(band.count / maxBand) * 100}%` }"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Purchasing power</h2>
                            <p class="text-xs text-zinc-500">
                                Seatless makers by gold held, as a share of the
                                {{ data.invitePriceGold?.toLocaleString() ?? "—" }}-gold price.
                            </p>
                        </div>
                        <div v-if="data.invitePriceGold" class="flex flex-col gap-3">
                            <div
                                v-for="band in data.affordBands"
                                :key="band.label"
                                class="flex flex-col gap-1.5"
                            >
                                <div class="flex items-baseline justify-between text-sm">
                                    <span
                                        :class="
                                            band.label === 'Can buy now'
                                                ? 'text-amber-200 font-bold'
                                                : 'text-zinc-300'
                                        "
                                    >
                                        {{ band.label }}
                                    </span>
                                    <span class="text-zinc-400 tabular-nums">
                                        {{ band.count.toLocaleString() }}
                                    </span>
                                </div>
                                <div class="h-2 w-full bg-zinc-800">
                                    <div
                                        class="h-full"
                                        :class="
                                            band.label === 'Can buy now'
                                                ? 'bg-amber-400'
                                                : 'bg-amber-400/40'
                                        "
                                        :style="{ width: `${(band.count / maxAfford) * 100}%` }"
                                    />
                                </div>
                            </div>
                        </div>
                        <div v-else class="text-sm text-zinc-500">
                            No <code>event_invite</code> shop item found, so there's no price to
                            compare balances against.
                        </div>
                    </div>

                    <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Where they're travelling from</h2>
                            <p class="text-xs text-zinc-500">
                                Top countries among seat holders — {{ data.countriesRepresented }}
                                represented in total.
                            </p>
                        </div>
                        <div v-if="data.topCountries.length" class="flex flex-col gap-3">
                            <div
                                v-for="country in data.topCountries"
                                :key="country.label"
                                class="flex flex-col gap-1.5"
                            >
                                <div class="flex items-baseline justify-between text-sm">
                                    <span class="text-zinc-300">{{ country.label }}</span>
                                    <span class="text-zinc-400 tabular-nums">
                                        {{ country.count.toLocaleString() }}
                                    </span>
                                </div>
                                <div class="h-2 w-full bg-zinc-800">
                                    <div
                                        class="h-full bg-emerald-400/70"
                                        :style="{ width: `${(country.count / maxCountry) * 100}%` }"
                                    />
                                </div>
                            </div>
                        </div>
                        <div v-else class="text-sm text-zinc-500">
                            No countries on file for seat holders yet.
                        </div>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                    <div class="flex flex-col gap-1">
                        <h2 class="text-lg font-bold text-white">Everything, split by attendance answer</h2>
                        <p class="text-xs text-zinc-500">
                            "Unanswered" is not a choice — it's everyone who hasn't seen or
                            answered the popup yet. Read the Yes column as a floor, not as demand.
                        </p>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="border-b border-zinc-800">
                                    <th class="text-left font-medium text-zinc-500 py-2 pr-4">Metric</th>
                                    <th
                                        v-for="s in data.byIntent"
                                        :key="s.intent"
                                        class="text-right font-medium py-2 px-3 whitespace-nowrap"
                                        :class="{
                                            'text-emerald-400': s.intent === 'yes',
                                            'text-red-400': s.intent === 'no',
                                            'text-zinc-500': s.intent === 'unanswered',
                                        }"
                                    >
                                        {{ INTENT_LABELS[s.intent] }}
                                    </th>
                                    <th class="text-right font-medium text-zinc-300 py-2 pl-3">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in INTENT_ROWS"
                                    :key="row.key"
                                    class="border-b border-zinc-800/50 last:border-0"
                                >
                                    <td
                                        class="py-2 pr-4 whitespace-nowrap"
                                        :class="
                                            row.label.startsWith('—')
                                                ? 'text-zinc-500 pl-3'
                                                : 'text-zinc-300'
                                        "
                                    >
                                        {{ row.label }}
                                    </td>
                                    <td
                                        v-for="s in data.byIntent"
                                        :key="s.intent"
                                        class="text-right tabular-nums py-2 px-3"
                                        :class="{
                                            'text-emerald-200': s.intent === 'yes',
                                            'text-red-200': s.intent === 'no',
                                            'text-zinc-400': s.intent === 'unanswered',
                                        }"
                                    >
                                        {{ s[row.key].toLocaleString() }}{{ row.suffix ?? "" }}
                                    </td>
                                    <td class="text-right tabular-nums py-2 pl-3 font-bold text-white">
                                        {{
                                            row.nonAdditive
                                                ? data.countriesRepresented.toLocaleString()
                                                : intentTotal(row.key).toLocaleString()
                                        }}{{ row.suffix ?? "" }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-1">
                    <span class="text-xs uppercase tracking-wide text-zinc-500">
                        Certificates claimed
                    </span>
                    <span class="text-3xl font-bold text-white tabular-nums">
                        {{ data.certificatesClaimed.toLocaleString() }}
                        <span class="text-lg text-zinc-600">
                            / {{ data.qualified.toLocaleString() }} seat holders
                        </span>
                    </span>
                    <span class="text-xs text-zinc-500">
                        Claiming confirms the name printed on the certificate — an unclaimed seat
                        holder has not confirmed their details yet.
                    </span>
                </div>
            </template>
        </div>
    </div>
</template>
