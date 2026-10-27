<script setup lang="ts">
definePageMeta({ layout: "internal" });

const route = useRoute();

type ShopItem = {
    id: number;
    slug: string | null;
    name: string;
    description: string | null;
    image_url: string | null;
    kind: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillment_provider: "internal" | "theseus" | "hcb" | "internal_synthetic";
    source: "hq" | "local" | null;
    price_gold: number;
    grant_amount_cents: number | null;
    inventory_mode: "unlimited" | "limited";
    stock_remaining: number | null;
    available_until: string | null;
    available: boolean;
    coming_soon: boolean;
    is_expired: boolean;
    is_sold_out: boolean;
    updated_at: string | null;
};

const items = ref<ShopItem[]>([]);
const loadingItems = ref(true);
const listError = ref("");
const isShopIndexRoute = computed(() => route.path.replace(/\/$/, "") === "/internal/shop");

const renovationEnabled = ref(false);
const renovationLoading = ref(false);
const renovationError = ref("");

// Saved changes queue server-side until published here, then go to Slack in one message.
type PendingShopChange = {
    itemId: number;
    itemName: string;
    action: string;
    title: string;
    emoji: string;
    fields: string[];
};

const pendingChanges = ref<PendingShopChange[]>([]);
const publishing = ref(false);
const publishError = ref("");
const publishSuccess = ref("");

async function fetchPendingChanges() {
    try {
        pendingChanges.value = (await $fetch<{ changes: PendingShopChange[] }>(
            "/api/internal/shop/pending-changes",
        )).changes;
    } catch (error) {
        console.error(error);
    }
}

async function publishChanges() {
    publishing.value = true;
    publishError.value = "";
    publishSuccess.value = "";
    try {
        const res = await $fetch<{ published: number }>(
            "/api/internal/shop/publish-changes",
            { method: "POST" },
        );
        publishSuccess.value =
            res.published > 0
                ? `Announced ${res.published} change${res.published === 1 ? "" : "s"} to Slack.`
                : "Nothing to publish.";
        await fetchPendingChanges();
    } catch (error) {
        console.error(error);
        publishError.value =
            typeof error === "object" &&
            error &&
            "data" in error &&
            typeof error.data === "object" &&
            error.data &&
            "statusMessage" in error.data &&
            typeof error.data.statusMessage === "string"
                ? error.data.statusMessage
                : "Failed to publish shop changes";
    } finally {
        publishing.value = false;
    }
}

async function fetchRenovationStatus() {
    try {
        renovationEnabled.value = (await $fetch<{ enabled: boolean }>(
            "/api/internal/app-settings/shop-renovation",
        )).enabled;
    } catch (error) {
        console.error(error);
    }
}

async function toggleRenovation(next: boolean) {
    renovationLoading.value = true;
    renovationError.value = "";
    try {
        renovationEnabled.value = (await $fetch<{ enabled: boolean }>(
            "/api/internal/app-settings/shop-renovation",
            { method: "PATCH", body: { enabled: next } },
        )).enabled;
    } catch (error) {
        console.error(error);
        renovationError.value = "Failed to update renovation toggle";
    } finally {
        renovationLoading.value = false;
    }
}

function formatStatusTag(item: ShopItem) {
    if (!item.available) return "Archived";
    if (item.is_expired) return "Expired";
    if (item.is_sold_out) return "Sold Out";
    if (item.coming_soon) return "Coming Soon";
    return "Live";
}

function statusTagClass(item: ShopItem) {
    if (!item.available) return "border-zinc-700 text-zinc-400";
    if (item.is_expired) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    if (item.is_sold_out) return "border-red-500/30 bg-red-500/10 text-red-300";
    if (item.coming_soon) return "border-purple-500/30 bg-purple-500/10 text-purple-300";
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function providerLabel(provider: ShopItem["fulfillment_provider"]) {
    if (provider === "theseus") return "Theseus";
    if (provider === "hcb") return "HCB";
    if (provider === "internal_synthetic") return "Code-fulfilled";
    return "Internal";
}

function kindLabel(kind: ShopItem["kind"]) {
    if (kind === "grant") return "Grant";
    if (kind === "consumable") return "Consumable";
    if (kind === "experience") return "Experience";
    if (kind === "virtual_service") return "Virtual Service";
    return "Physical";
}

function inventoryLabel(item: ShopItem) {
    return item.inventory_mode === "limited"
        ? `${item.stock_remaining ?? 0} left`
        : "Unlimited";
}

function formatUpdatedAt(value: string | null) {
    return value ? new Date(value).toLocaleString() : "Unknown update";
}

async function fetchItems() {
    loadingItems.value = true;
    listError.value = "";

    try {
        items.value = await $fetch<ShopItem[]>("/api/internal/shop/items");
    } catch (error) {
        console.error(error);
        listError.value = "Failed to load shop items";
    } finally {
        loadingItems.value = false;
    }
}

watch(
    isShopIndexRoute,
    (isIndex) => {
        // Refetch on every entry so coming back from an item page after a save shows fresh data.
        if (isIndex) {
            void fetchItems();
            void fetchRenovationStatus();
            void fetchPendingChanges();
        }
    },
    { immediate: true },
);
</script>

<template>
    <NuxtPage v-if="!isShopIndexRoute" />

    <div v-else class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-7xl mx-auto flex flex-col gap-6">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="flex flex-col gap-1">
                    <h1 class="text-3xl font-bold text-white tracking-tight">Shop Config</h1>
                    <p class="text-zinc-400 text-sm">
                        Time to waste money that is not yours!
                    </p>
                </div>

                <NuxtLink
                    to="/internal/shop/new"
                    class="px-4 py-2.5 text-sm font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors"
                >
                    New Item
                </NuxtLink>
            </div>

            <div
                class="border p-4 flex items-start justify-between gap-4 flex-wrap"
                :class="renovationEnabled
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-zinc-800 bg-zinc-900/40'"
            >
                <div class="flex flex-col gap-1 min-w-0">
                    <p class="text-sm font-bold" :class="renovationEnabled ? 'text-amber-200' : 'text-zinc-200'">
                        Shop under renovation
                    </p>
                    <p class="text-xs text-zinc-400">
                        While enabled, the public shop hides every item and shows a "we'll be back" banner instead. Use during major restocks or pricing overhauls.
                    </p>
                    <p v-if="renovationError" class="text-xs text-red-300">{{ renovationError }}</p>
                </div>
                <label class="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                    <span class="text-xs uppercase tracking-widest font-bold" :class="renovationEnabled ? 'text-amber-200' : 'text-zinc-400'">
                        {{ renovationEnabled ? "On" : "Off" }}
                    </span>
                    <input
                        type="checkbox"
                        :checked="renovationEnabled"
                        :disabled="renovationLoading"
                        class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                        @change="(e) => toggleRenovation((e.target as HTMLInputElement).checked)"
                    >
                </label>
            </div>

            <div
                v-if="pendingChanges.length > 0"
                class="border border-sky-500/50 bg-sky-500/10 p-4 flex flex-col gap-3"
            >
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="flex flex-col gap-1 min-w-0">
                        <p class="text-sm font-bold text-sky-200">
                            {{ pendingChanges.length }} unpublished change{{ pendingChanges.length === 1 ? "" : "s" }}
                        </p>
                        <p class="text-xs text-zinc-400">
                            Saved changes are queued here and announced to Slack in a single message when you publish.
                        </p>
                        <p v-if="publishError" class="text-xs text-red-300">{{ publishError }}</p>
                    </div>
                    <button
                        :disabled="publishing"
                        class="px-4 py-2.5 text-sm font-bold border border-sky-400 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        @click="publishChanges"
                    >
                        {{ publishing ? "Publishing..." : "Publish to Slack" }}
                    </button>
                </div>
                <ul class="flex flex-col gap-1">
                    <li
                        v-for="change in pendingChanges"
                        :key="change.itemId"
                        class="text-xs text-zinc-300"
                    >
                        {{ change.emoji }}
                        <NuxtLink
                            v-if="change.action !== 'delete_shop_item'"
                            :to="`/internal/shop/${change.itemId}`"
                            class="font-bold text-white hover:text-sky-200"
                        >
                            {{ change.itemName }}
                        </NuxtLink>
                        <span v-else class="font-bold text-white">{{ change.itemName }}</span>
                        — {{ change.title }} · {{ change.fields.join(", ") }}
                    </li>
                </ul>
            </div>
            <p v-else-if="publishSuccess" class="text-xs text-emerald-300">{{ publishSuccess }}</p>

            <div class="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Items</p>
                    <p class="text-sm text-zinc-400">{{ items.length }} configured</p>
                </div>
            </div>

            <p v-if="listError" class="text-sm text-red-300">{{ listError }}</p>
            <p v-else-if="loadingItems" class="text-sm text-zinc-500">Loading items...</p>

            <div
                v-else-if="items.length > 0"
                class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5"
            >
                <NuxtLink
                    v-for="item in items"
                    :key="item.id"
                    :to="`/internal/shop/${item.id}`"
                    class="group border border-zinc-800 bg-zinc-900/40 hover:border-amber-400/60 transition-colors overflow-hidden"
                >
                    <div class="relative aspect-[4/3] border-b border-zinc-800 bg-black/40 overflow-hidden">
                        <img
                            v-if="item.image_url"
                            :src="item.image_url"
                            :alt="item.name"
                            class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        >
                        <div
                            v-else
                            class="w-full h-full flex items-center justify-center text-sm text-zinc-500"
                        >
                            No image configured
                        </div>

                        <div class="absolute top-3 right-3 flex gap-2">
                            <span
                                v-if="item.slug"
                                class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border backdrop-blur-sm border-sky-500/30 bg-sky-500/10 text-sky-200"
                                title="This item is referenced by code via its slug. Renaming / deleting it can break fulfillment."
                            >
                                System
                            </span>
                            <span
                                class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border backdrop-blur-sm"
                                :class="statusTagClass(item)"
                            >
                                {{ formatStatusTag(item) }}
                            </span>
                        </div>
                    </div>

                    <div class="p-4 flex flex-col gap-3">
                        <div class="min-w-0">
                            <p class="font-bold text-white truncate">{{ item.name }}</p>
                            <p class="text-xs text-zinc-500 mt-1">
                                ${{ (item.price_gold / 10).toFixed(2) }} ({{ item.price_gold }} gold)
                                <span v-if="item.kind === 'grant' && item.grant_amount_cents != null">
                                    · ${{ (item.grant_amount_cents / 100).toFixed(2) }} grant
                                </span>
                            </p>
                        </div>

                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ kindLabel(item.kind) }}
                            </span>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ providerLabel(item.fulfillment_provider) }}
                            </span>
                            <span
                                v-if="item.source"
                                class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400"
                            >
                                {{ item.source === 'hq' ? 'HQ' : 'Local' }}
                            </span>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ inventoryLabel(item) }}
                            </span>
                        </div>

                        <p class="text-xs text-zinc-600">
                            Updated {{ formatUpdatedAt(item.updated_at) }}
                        </p>
                    </div>
                </NuxtLink>
            </div>

            <div
                v-else
                class="border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-sm text-zinc-500"
            >
                No shop items exist yet.
            </div>
        </div>
    </div>
</template>
