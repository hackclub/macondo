<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed, onBeforeUnmount, ref, watch } from "vue";

const { t } = useI18n();

const route = useRoute();
const { data: meData } = useFetch<{
    permissions: {
        canAccessOrders: boolean;
        canAccessShopAdmin: boolean;
        canAccessStats: boolean;
        canAccessUsers: boolean;
        canAccessSupport: boolean;
        canAccessEvents: boolean;
        canAccessShippedProjects: boolean;
        canAccessCertificates: boolean;
        canManageFAQ: boolean;
        canManageAnnouncements: boolean;
        canManageMcpTokens: boolean;
    };
}>("/api/internal/me", { server: false });

const canAccessUsers = computed(
    () => meData.value?.permissions?.canAccessUsers ?? false,
);
const canAccessOrders = computed(
    () => meData.value?.permissions?.canAccessOrders ?? false,
);
const canAccessShopAdmin = computed(
    () => meData.value?.permissions?.canAccessShopAdmin ?? false,
);
const canAccessStats = computed(
    () => meData.value?.permissions?.canAccessStats ?? false,
);
const canAccessSupport = computed(
    () => meData.value?.permissions?.canAccessSupport ?? false,
);
const canAccessEvents = computed(
    () => meData.value?.permissions?.canAccessEvents ?? false,
);
const canAccessShippedProjects = computed(
    () => meData.value?.permissions?.canAccessShippedProjects ?? false,
);
const canAccessCertificates = computed(
    () => meData.value?.permissions?.canAccessCertificates ?? false,
);
const canManageFAQ = computed(
    () => meData.value?.permissions?.canManageFAQ ?? false,
);
const canManageAnnouncements = computed(
    () => meData.value?.permissions?.canManageAnnouncements ?? false,
);
const canManageMcpTokens = computed(
    () => meData.value?.permissions?.canManageMcpTokens ?? false,
);

const showHeader = computed(
    () => route.path !== "/internal" && route.path.startsWith("/internal"),
);
const showSearch = computed(() => showHeader.value);

const reviewNavItems = computed(() => [
    { to: "/internal/shipped", label: "Shipped", show: canAccessShippedProjects.value },
    { to: "/internal/certificates", label: "Certificates", show: canAccessCertificates.value },
]);

const opsNavItems = computed(() => [
    { to: "/internal/users", label: "Users", show: canAccessUsers.value },
    { to: "/internal/support", label: "Support", show: canAccessSupport.value },
    { to: "/internal/events", label: "Events", show: canAccessEvents.value },
    { to: "/internal/announcements", label: "Announcements", show: canManageAnnouncements.value },
    { to: "/internal/faq-suggestions", label: "FAQ", show: canManageFAQ.value },
    { to: "/internal/docs-misses", label: "Docs misses", show: canManageFAQ.value },
    { to: "/internal/mcp", label: "MCP", show: canManageMcpTokens.value },
]);

const financeNavItems = computed(() => [
    { to: "/internal/orders", label: "Orders", show: canAccessOrders.value },
    { to: "/internal/shop", label: "Shop", show: canAccessShopAdmin.value },
    { to: "/internal/shop-requests", label: "Shop requests", show: canAccessShopAdmin.value },
    { to: "/internal/grants", label: "Grants", show: canAccessShopAdmin.value },
    { to: "/internal/hcb", label: "HCB", show: canAccessShopAdmin.value },
]);

const insightsNavItems = computed(() => [
    { to: "/internal/analytics", label: "Analytics", show: canAccessStats.value },
    { to: "/internal/stats", label: "Stats", show: canAccessStats.value },
    { to: "/internal/event-progress", label: "Event progress", show: canAccessStats.value },
    { to: "/internal/nps", label: "NPS", show: canAccessStats.value },
]);

const searchQuery = useState("internalSearchQuery", () => "");
type InternalSearchResult = {
    id: string;
    type: "user" | "project" | "ship" | "shop_item" | "order";
    title: string;
    subtitle: string;
    href: string;
    image: string | null;
    badge: string;
};

const suggestionResults = ref<InternalSearchResult[]>([]);
const loadingSuggestions = ref(false);

const isDropdownVisible = ref(true);
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0);
const showSuggestions = computed(
    () => hasSearchQuery.value && isDropdownVisible.value,
);

watch(searchQuery, () => {
    isDropdownVisible.value = true;
});

const router = useRouter();

const handleEnter = () => {
    const firstResult = suggestionResults.value[0];
    if (!firstResult) return;
    handleSuggestionClick(firstResult);
};

const handleSuggestionClick = (result: InternalSearchResult) => {
    isDropdownVisible.value = false;
    searchQuery.value = "";
    router.push(result.href);
};

const resultBadgeClass = (type: InternalSearchResult["type"]) => {
    if (type === "user") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
    if (type === "project") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    if (type === "ship") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    if (type === "order") return "border-teal-500/30 bg-teal-500/10 text-teal-200";
    return "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200";
};

const resultInitial = (result: InternalSearchResult) =>
    (result.title.trim().charAt(0) || result.badge.charAt(0) || "?").toUpperCase();

watch(
    () => route.query.search,
    (value) => {
        searchQuery.value = typeof value === "string" ? value : "";
    },
    { immediate: true },
);

let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
let suggestionController: AbortController | null = null;
let suggestionRequestId = 0;

onBeforeUnmount(() => {
    ++suggestionRequestId;
    if (suggestionTimer) clearTimeout(suggestionTimer);
    suggestionTimer = null;
    suggestionController?.abort();
    suggestionController = null;
});

watch(searchQuery, (value) => {
    if (suggestionTimer) clearTimeout(suggestionTimer);
    suggestionTimer = null;
    const requestId = ++suggestionRequestId;
    suggestionController?.abort();
    suggestionController = null;

    const trimmed = value.trim();
    if (!trimmed) {
        suggestionResults.value = [];
        loadingSuggestions.value = false;
        return;
    }

    loadingSuggestions.value = true;
    suggestionTimer = setTimeout(async () => {
        suggestionTimer = null;
        const controller = new AbortController();
        suggestionController = controller;
        try {
            const response = await $fetch<{
                results: InternalSearchResult[];
            }>("/api/internal/search", {
                signal: controller.signal,
                params: {
                    q: trimmed,
                    limit: 8,
                },
            });

            if (requestId === suggestionRequestId) {
                suggestionResults.value = response.results;
            }
        } catch {
            if (requestId === suggestionRequestId) {
                suggestionResults.value = [];
            }
        } finally {
            if (requestId === suggestionRequestId) {
                suggestionController = null;
                loadingSuggestions.value = false;
            }
        }
    }, 180); // debounce suggestions while typing
});
</script>

<template>
    <header
        v-if="showHeader"
        class="absolute top-0 left-0 right-0 z-50 w-full pt-4 px-4 md:px-6 pointer-events-none"
    >
        <div class="flex flex-col gap-2 w-full md:hidden pointer-events-auto">
            <div
                v-if="showSearch"
                class="relative bg-transparent border border-zinc-700 rounded-sm"
            >
                <div class="flex items-center px-3 py-2.5">
                    <svg
                        class="h-4 w-4 text-zinc-400 mr-3 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <input
                        v-model="searchQuery"
                        type="search"
                        class="w-full bg-transparent text-[15px] font-medium text-white placeholder-zinc-500 focus:outline-none"
                        :placeholder="t('internal.search_placeholder')"
                        spellcheck="false"
                        @keydown.enter="handleEnter"
                        @focus="isDropdownVisible = true"
                    >
                    <button
                        v-if="searchQuery"
                        class="ml-2 flex-shrink-0 text-zinc-400 hover:text-white transition-colors"
                        @click="searchQuery = ''"
                    >
                        <svg class="h-4 w-4 stroke-[3px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div
                    v-if="showSuggestions"
                    class="absolute top-full left-0 right-0 mt-1 bg-zinc-950 border border-zinc-700/50 shadow-2xl overflow-hidden py-1 z-50"
                >
                    <div
                        v-if="loadingSuggestions"
                        class="px-3 py-2 text-xs text-zinc-500"
                    >
                        Searching...
                    </div>
                    <template v-else-if="suggestionResults.length > 0">
                        <button
                            v-for="result in suggestionResults"
                            :key="`${result.type}:${result.id}`"
                            type="button"
                            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 cursor-pointer group text-left"
                            @mousedown.prevent
                            @click="handleSuggestionClick(result)"
                        >
                            <img
                                v-if="result.image"
                                :src="result.image"
                                :alt="result.title"
                                class="w-7 h-7 border border-zinc-700 bg-black object-cover"
                                :class="result.type === 'user' ? 'rounded-full' : 'rounded-sm'"
                            >
                            <div
                                v-else
                                class="w-7 h-7 flex items-center justify-center text-[10px] font-bold text-white bg-black border border-zinc-700"
                                :class="result.type === 'user' ? 'rounded-full' : 'rounded-sm'"
                            >
                                {{ resultInitial(result) }}
                            </div>
                            <div class="flex flex-col min-w-0 flex-1">
                                <span class="text-sm font-medium text-white group-hover:text-amber-200 truncate">{{ result.title }}</span>
                                <span class="text-[10px] text-zinc-500 font-mono tracking-tighter truncate">
                                    {{ result.subtitle || result.href }}
                                </span>
                            </div>
                            <span
                                class="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border shrink-0"
                                :class="resultBadgeClass(result.type)"
                            >
                                {{ result.badge }}
                            </span>
                        </button>
                    </template>
                    <div
                        v-else
                        class="px-3 py-2 text-xs text-zinc-500"
                    >
                        No results found.
                    </div>
                    <div
                        v-if="!loadingSuggestions && suggestionResults.length > 0"
                        class="border-t border-zinc-700/30 px-3 py-2"
                    >
                        <button
                            class="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors w-full text-left"
                            @click="handleEnter"
                        >
                            Press Enter to open top result
                        </button>
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-between gap-2">
                <nav class="flex items-center gap-4 whitespace-nowrap flex-wrap">
                    <InternalNavDropdown
                        label="Reviews"
                        :items="reviewNavItems"
                    />
                    <InternalNavDropdown
                        label="Ops"
                        :items="opsNavItems"
                    />
                    <InternalNavDropdown
                        label="Finance"
                        :items="financeNavItems"
                    />
                    <InternalNavDropdown
                        label="Insights"
                        :items="insightsNavItems"
                    />
                </nav>
                <NuxtLink
                    to="/dashboard"
                    class="flex-shrink-0 bg-white hover:bg-zinc-200 text-black text-xs font-medium px-3 py-1.5 transition-colors"
                >
                    Exit
                </NuxtLink>
            </div>
        </div>

        <div class="hidden md:block w-full">
            <div class="max-w-7xl mx-auto relative min-h-[42px] flex items-center justify-between gap-6">
                <nav
                    class="flex items-center gap-4 lg:gap-6 pointer-events-auto min-w-0 whitespace-nowrap"
                    :class="showSearch ? 'max-w-[calc(50%_-_230px)] pr-2' : ''"
                >
                    <InternalNavDropdown
                        label="Reviews"
                        :items="reviewNavItems"
                    />
                    <InternalNavDropdown
                        label="Ops"
                        :items="opsNavItems"
                    />
                    <InternalNavDropdown
                        label="Finance"
                        :items="financeNavItems"
                    />
                    <InternalNavDropdown
                        label="Insights"
                        :items="insightsNavItems"
                    />
                </nav>

                <div
                    v-if="showSearch"
                    class="absolute left-1/2 top-1/2 z-20 w-[clamp(280px,34vw,420px)] -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                >
                    <div class="relative bg-transparent border border-zinc-700 rounded-sm">
                        <div class="flex items-center px-3 py-2.5">
                            <svg class="h-4 w-4 text-zinc-400 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                v-model="searchQuery"
                                type="search"
                                class="w-full bg-transparent text-[15px] font-medium text-white placeholder-zinc-500 focus:outline-none"
                                :placeholder="t('internal.search_placeholder')"
                                spellcheck="false"
                                @keydown.enter="handleEnter"
                                @focus="isDropdownVisible = true"
                            >
                            <button
                                v-if="searchQuery"
                                class="ml-2 flex-shrink-0 text-zinc-400 hover:text-white transition-colors"
                                @click="searchQuery = ''"
                            >
                                <svg class="h-4 w-4 stroke-[3px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div
                            v-if="showSuggestions"
                            class="absolute top-full left-0 right-0 mt-1 bg-zinc-950 border border-zinc-700/50 shadow-2xl overflow-hidden py-1"
                        >
                            <div
                                v-if="loadingSuggestions"
                                class="px-3 py-2 text-xs text-zinc-500"
                            >
                                Searching...
                            </div>
                            <template v-else-if="suggestionResults.length > 0">
                                <button
                                    v-for="result in suggestionResults"
                                    :key="`${result.type}:${result.id}`"
                                    type="button"
                                    class="w-full flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 cursor-pointer group text-left"
                                    @mousedown.prevent
                                    @click="handleSuggestionClick(result)"
                                >
                                    <img
                                        v-if="result.image"
                                        :src="result.image"
                                        :alt="result.title"
                                        class="w-7 h-7 border border-zinc-700 bg-black object-cover"
                                        :class="result.type === 'user' ? 'rounded-full' : 'rounded-sm'"
                                    >
                                    <div
                                        v-else
                                        class="w-7 h-7 flex items-center justify-center text-[10px] font-bold text-white bg-black border border-zinc-700"
                                        :class="result.type === 'user' ? 'rounded-full' : 'rounded-sm'"
                                    >
                                        {{ resultInitial(result) }}
                                    </div>
                                    <div class="flex flex-col min-w-0 flex-1">
                                        <span class="text-sm font-medium text-white group-hover:text-amber-200 truncate">{{ result.title }}</span>
                                        <span class="text-[10px] text-zinc-500 font-mono tracking-tighter truncate">
                                            {{ result.subtitle || result.href }}
                                        </span>
                                    </div>
                                    <span
                                        class="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border shrink-0"
                                        :class="resultBadgeClass(result.type)"
                                    >
                                        {{ result.badge }}
                                    </span>
                                </button>
                            </template>
                            <div
                                v-else
                                class="px-3 py-2 text-xs text-zinc-500"
                            >
                                No results found.
                            </div>
                            <div
                                v-if="!loadingSuggestions && suggestionResults.length > 0"
                                class="border-t border-zinc-700/30 px-3 py-2"
                            >
                                <button
                                    class="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors w-full text-left"
                                    @click="handleEnter"
                                >
                                    Press Enter to open top result
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pointer-events-auto flex-shrink-0 flex items-center justify-center">
                    <NuxtLink
                        to="/dashboard"
                        class="bg-white hover:bg-zinc-200 text-black text-sm font-medium px-4 py-2 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                        {{ t("internal.exit_internal") }}
                    </NuxtLink>
                </div>
            </div>
        </div>
    </header>
</template>

<style scoped>
/* Hide Chrome/Safari's native search clear "X" so it doesn't double up with our custom clear button. */
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
}
</style>
