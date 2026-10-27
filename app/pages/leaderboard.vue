<script setup lang="ts">
import { Trophy } from "lucide-vue-next";

definePageMeta({
    layout: false,
});

type LeaderboardType = "upvotes" | "hours" | "ships" | "gold" | "referrals";
const LEADERBOARD_TYPE_OPTIONS: LeaderboardType[] = [
    "upvotes",
    "hours",
    "ships",
    "gold",
    "referrals",
];

interface LeaderboardRow {
    rank: number;
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    created_at: string | Date | null;
    metric: number;
    project_count: number;
}

function slackUrlFor(slackId: string | null): string | null {
    return slackId ? `https://hackclub.slack.com/team/${slackId}` : null;
}

function memberSinceFor(date: string | Date | null): string {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

function pickType(raw: unknown): LeaderboardType {
    const v = typeof raw === "string" ? raw : "";
    if (["upvotes", "hours", "ships", "gold", "referrals"].includes(v)) {
        return v as LeaderboardType;
    }
    return "upvotes";
}

const leaderboardType = ref<LeaderboardType>(pickType(route.query.type));

const items = ref<LeaderboardRow[]>([]);
const loading = ref(false);
let requestId = 0;

async function load() {
    const id = ++requestId;
    loading.value = true;
    try {
        const data = await $fetch<{ type: string; items: LeaderboardRow[] }>(
            "/api/explore/leaderboard",
            { query: { type: leaderboardType.value, limit: 50 } },
        );
        if (id !== requestId) return;
        items.value = data.items;
    } catch (err) {
        console.error("[leaderboard] fetch failed", err);
    } finally {
        loading.value = false;
    }
}

watch(leaderboardType, (next) => {
    void router.replace({ path: route.path, query: { ...route.query, type: next } });
    void load();
});

onMounted(() => void load());

const PODIUM_STYLES = [
    { tint: "text-yellow-500", border: "border-yellow-600", label: "1st" },
    { tint: "text-zinc-400", border: "border-zinc-500", label: "2nd" },
    { tint: "text-orange-700", border: "border-orange-700", label: "3rd" },
];

function formatMetric(value: number, type: LeaderboardType): string {
    if (type === "hours") return `${Math.round(value).toLocaleString()}h`;
    return Math.round(value).toLocaleString();
}

function metricLabel(type: LeaderboardType): string {
    return t(`leaderboard.metric.${type}`);
}
</script>

<template>
    <div class="min-h-screen bg-parchment relative">
        <div class="max-w-5xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-6">
            <NuxtLink
                to="/dashboard"
                class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t("explore.back") }}
            </NuxtLink>

            <div>
                <div class="flex flex-col gap-6">
                    <header class="flex items-center gap-3">
                        <Trophy class="w-9 h-9 text-yellow-600" />
                        <div>
                            <h1 class="text-3xl font-bold text-ds-brown leading-tight">{{ $t("leaderboard.title") }}</h1>
                            <p class="text-sm text-ds-brown/70">{{ $t("leaderboard.subtitle") }}</p>
                        </div>
                    </header>

                    <div class="flex flex-wrap items-center gap-1.5">
                        <button
                            v-for="lt in LEADERBOARD_TYPE_OPTIONS"
                            :key="lt"
                            type="button"
                            class="h-9 px-3 text-xs font-bold border-2 transition-colors"
                            :class="leaderboardType === lt ? 'bg-ds-brown text-parchment border-ds-brown' : 'bg-parchment text-ds-brown border-ds-brown/30 hover:border-ds-brown'"
                            @click="leaderboardType = lt"
                        >
                            {{ $t(`leaderboard.metric.${lt}`) }}
                        </button>
                    </div>

                    <p v-if="loading && items.length === 0" class="text-xs text-ds-brown/50 text-center py-3">
                        {{ $t("explore.loading") }}
                    </p>

                    <div v-if="items.length > 0" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <NuxtLink
                            v-for="(person, i) in items.slice(0, 3)"
                            :key="person.id"
                            :to="`/u/${person.id}`"
                            class="flex flex-col items-center gap-2 p-4 border-[3px] bg-parchment hover:bg-ds-brown/5 transition-colors text-center no-underline"
                            :class="PODIUM_STYLES[i]?.border"
                        >
                            <div class="relative">
                                <div
                                    class="w-20 h-20 rounded-full overflow-hidden border-[3px]"
                                    :class="PODIUM_STYLES[i]?.border"
                                >
                                    <img
                                        v-if="person.image"
                                        :src="person.image"
                                        :alt="person.username ?? ''"
                                        class="w-full h-full object-cover"
                                    >
                                    <div
                                        v-else
                                        class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-2xl font-bold text-ds-brown"
                                    >{{ (person.username ?? "?").charAt(0).toUpperCase() }}</div>
                                </div>
                                <div
                                    class="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 bg-parchment"
                                    :class="[PODIUM_STYLES[i]?.border, PODIUM_STYLES[i]?.tint]"
                                >{{ PODIUM_STYLES[i]?.label }}</div>
                            </div>
                            <div class="flex flex-col items-center w-full min-w-0">
                                <span class="text-sm font-bold text-ds-brown truncate w-full">{{ person.username ?? "—" }}</span>
                            </div>
                            <div class="flex flex-col items-center text-ds-brown">
                                <span class="text-xl font-bold tabular-nums">{{ formatMetric(person.metric, leaderboardType) }}</span>
                                <span class="text-[10px] uppercase tracking-wider text-ds-brown/60">{{ metricLabel(leaderboardType) }}</span>
                            </div>
                        </NuxtLink>
                    </div>

                    <ol v-if="items.length > 3" class="flex flex-col divide-y-2 divide-ds-brown/10 border-2 border-ds-brown/10">
                        <NuxtLink
                            v-for="person in items.slice(3)"
                            :key="person.id"
                            :to="`/u/${person.id}`"
                            class="flex items-center gap-3 px-3 py-2 hover:bg-ds-brown/5 transition-colors no-underline"
                        >
                            <span class="w-7 text-right text-xs font-bold text-ds-brown/50 tabular-nums">#{{ person.rank }}</span>
                            <div class="w-8 h-8 rounded-full overflow-hidden border-2 border-ds-brown/30 shrink-0">
                                <img
                                    v-if="person.image"
                                    :src="person.image"
                                    :alt="person.username ?? ''"
                                    class="w-full h-full object-cover"
                                >
                                <div
                                    v-else
                                    class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-xs font-bold text-ds-brown"
                                >{{ (person.username ?? "?").charAt(0).toUpperCase() }}</div>
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-bold text-ds-brown truncate">{{ person.username ?? "—" }}</p>
                            </div>
                            <span class="text-sm font-bold text-ds-brown tabular-nums shrink-0">{{ formatMetric(person.metric, leaderboardType) }}</span>
                        </NuxtLink>
                    </ol>

                    <p v-if="!loading && items.length === 0" class="text-sm text-ds-brown/60 py-8 text-center">
                        {{ $t("leaderboard.empty") }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>
