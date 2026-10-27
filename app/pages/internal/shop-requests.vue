<script setup lang="ts">
import { computed, ref, watch } from "vue";

definePageMeta({ layout: "internal" });

type PricingInfo = {
    stores: Array<{
        store_name: string;
        likely_url: string;
        estimated_price_usd: number | null;
        notes?: string;
    }>;
    fetched_at: string;
};

type RequestRow = {
    id: number;
    name: string;
    description: string | null;
    store_url: string | null;
    image_url: string | null;
    cluster_id: number | null;
    group_tag: string | null;
    upvote_count: number;
    pricing_info: PricingInfo | null;
    promoted_to_item_id: number | null;
    dismissed_at: string | null;
    dismissed_reason: string | null;
    created_at: string | null;
    user: {
        id: string;
        name: string;
        image: string | null;
        slack_id: string | null;
    } | null;
};

type ListResponse = { items: RequestRow[]; dismissedItems: RequestRow[] };

type PromoteForm = {
    name: string;
    description: string;
    imageUrl: string;
    kind: "physical" | "grant" | "virtual_service";
    fulfillmentProvider: "internal" | "theseus" | "hcb";
    priceGold: number;
    grantAmountDollars: number | null;
    stockRemaining: number | null;
    storeUrl: string;
    naRegionPriceGold: number | null;
};

const { data, pending, error, refresh } = useFetch<ListResponse>(
    "/api/internal/shop-requests",
    { server: false },
);

const requests = computed<RequestRow[]>(() => data.value?.items ?? []);
const dismissedRequests = computed<RequestRow[]>(() =>
    (data.value?.dismissedItems ?? []).filter((item) => !!item.dismissed_reason?.trim()),
);

type Group = {
    key: string;
    cluster_id: number | null;
    group_tag: string | null;
    vote_count: number;
    items: RequestRow[];
};

const groups = computed<Group[]>(() => {
    const byCluster = new Map<string, Group>();
    const ungrouped: Group[] = [];

    for (const r of requests.value) {
        const groupKey = r.group_tag || (r.cluster_id != null ? `Cluster #${r.cluster_id}` : "");
        if (groupKey) {
            const key = r.group_tag ? `tag-${r.group_tag}` : `c-${r.cluster_id}`;
            const existing = byCluster.get(key);
            if (existing) {
                existing.items.push(r);
                existing.vote_count += r.upvote_count;
            } else {
                byCluster.set(key, {
                    key,
                    cluster_id: r.cluster_id,
                    group_tag: r.group_tag ?? groupKey,
                    vote_count: r.upvote_count,
                    items: [r],
                });
            }
        } else {
            ungrouped.push({
                key: `r-${r.id}`,
                cluster_id: null,
                group_tag: null,
                vote_count: r.upvote_count,
                items: [r],
            });
        }
    }

    return [
        ...[...byCluster.values()].sort((a, b) => b.vote_count - a.vote_count),
        ...ungrouped.sort((a, b) => b.vote_count - a.vote_count),
    ];
});

const clusterBusy = ref(false);
const clusterError = ref<string | null>(null);
const clusterResult = ref<string | null>(null);
const dismissBackfillBusy = ref(false);
const dismissBackfillResult = ref<string | null>(null);
const pricingBusy = ref<Record<number, boolean>>({});
const dismissBusy = ref<Record<number, boolean>>({});

async function runCluster() {
    clusterBusy.value = true;
    clusterError.value = null;
    clusterResult.value = null;
    try {
        const res = await $fetch<{
            tagged: number;
            tagTotal: number;
            clustered: number;
            total: number;
        }>("/api/internal/shop-requests/cluster", { method: "POST" });
        clusterResult.value = `Tagged ${res.tagged}/${res.tagTotal} recent requests; clustered ${res.clustered}/${res.total}.`;
        await refresh();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        clusterError.value =
            typedErr?.data?.message ?? typedErr?.statusMessage ?? "Clustering failed.";
    } finally {
        clusterBusy.value = false;
    }
}

async function runDismissBackfill() {
    dismissBackfillBusy.value = true;
    dismissBackfillResult.value = null;
    try {
        const res = await $fetch<{ dismissed: number }>(
            "/api/internal/shop-requests/dismiss-backfill",
            { method: "POST" },
        );
        dismissBackfillResult.value = `Dismissed ${res.dismissed} suggestion${res.dismissed === 1 ? "" : "s"} matching existing shop items.`;
        await refresh();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        dismissBackfillResult.value = `Error: ${typedErr?.data?.message ?? typedErr?.statusMessage ?? "Backfill failed."}`;
    } finally {
        dismissBackfillBusy.value = false;
    }
}

async function findPricing(requestId: number) {
    pricingBusy.value = { ...pricingBusy.value, [requestId]: true };
    try {
        await $fetch(`/api/internal/shop-requests/${requestId}/find-pricing`, {
            method: "POST",
        });
        await refresh();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        alert(
            typedErr?.data?.message ?? typedErr?.statusMessage ?? "Pricing lookup failed.",
        );
    } finally {
        pricingBusy.value = { ...pricingBusy.value, [requestId]: false };
    }
}

async function dismiss(requestId: number) {
    const reason = window.prompt("Why is this suggestion rejected?");
    if (!reason || !reason.trim()) return;
    dismissBusy.value = { ...dismissBusy.value, [requestId]: true };
    try {
        await $fetch(`/api/internal/shop-requests/${requestId}/dismiss`, {
            method: "POST",
            body: { reason: reason.trim() },
        });
        await refresh();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        alert(typedErr?.data?.message ?? typedErr?.statusMessage ?? "Dismiss failed.");
    } finally {
        dismissBusy.value = { ...dismissBusy.value, [requestId]: false };
    }
}

const promoteOpenFor = ref<number | null>(null);
const promoteForm = ref<PromoteForm>({
    name: "",
    description: "",
    imageUrl: "",
    kind: "physical",
    fulfillmentProvider: "internal",
    priceGold: 100,
    grantAmountDollars: null,
    stockRemaining: null,
    storeUrl: "",
    naRegionPriceGold: null,
});
const promoteBusy = ref(false);
const promoteError = ref<string | null>(null);

watch(
    () => promoteForm.value.kind,
    (kind) => {
        if (kind === "grant") {
            promoteForm.value.fulfillmentProvider = "hcb";
        } else if (kind === "virtual_service") {
            promoteForm.value.fulfillmentProvider = "internal";
            promoteForm.value.grantAmountDollars = null;
        } else if (promoteForm.value.fulfillmentProvider === "hcb") {
            promoteForm.value.fulfillmentProvider = "internal";
            promoteForm.value.grantAmountDollars = null;
        }
    },
);

function openPromote(group: Group) {
    const first = group.items[0];
    if (!first) return;

    let naPrice: number | null = null;
    let storeUrl = first.store_url ?? "";
    const firstStore = first.pricing_info?.stores?.[0];
    if (firstStore?.estimated_price_usd != null) {
        naPrice = Math.max(10, Math.round(firstStore.estimated_price_usd * 10));
    }
    if (!storeUrl && firstStore?.likely_url) {
        storeUrl = firstStore.likely_url;
    }

    promoteForm.value = {
        name: first.name,
        description: first.description ?? "",
        imageUrl: first.image_url ?? "",
        kind: "physical",
        fulfillmentProvider: "internal",
        priceGold: naPrice ?? 100,
        grantAmountDollars: null,
        stockRemaining: null,
        storeUrl,
        naRegionPriceGold: naPrice,
    };
    promoteOpenFor.value = first.id;
    promoteError.value = null;
}

function closePromote() {
    promoteOpenFor.value = null;
    promoteError.value = null;
}

async function submitPromote() {
    if (promoteOpenFor.value == null) return;
    const id = promoteOpenFor.value;
    promoteBusy.value = true;
    promoteError.value = null;

    const f = promoteForm.value;
    const regionalPricing: Record<string, { priceGold?: number | null; storeUrl?: string | null }> = {};
    if (f.naRegionPriceGold != null && f.storeUrl) {
        regionalPricing.NA = {
            priceGold: f.naRegionPriceGold,
            storeUrl: f.storeUrl,
        };
    }

    try {
        await $fetch(`/api/internal/shop-requests/${id}/promote`, {
            method: "POST",
            body: {
                name: f.name,
                description: f.description || null,
                imageUrl: f.imageUrl || null,
                kind: f.kind,
                fulfillmentProvider: f.kind === "virtual_service" ? "internal" : f.fulfillmentProvider,
                priceGold: f.priceGold,
                grantAmountDollars: f.grantAmountDollars,
                inventoryMode: f.stockRemaining != null ? "limited" : "unlimited",
                stockRemaining: f.stockRemaining,
                available: true,
                regionalPricing: Object.keys(regionalPricing).length > 0 ? regionalPricing : null,
                attachmentUrls: [],
            },
        });
        closePromote();
        await refresh();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        promoteError.value =
            typedErr?.data?.message
            ?? typedErr?.statusMessage
            ?? "Promotion failed.";
    } finally {
        promoteBusy.value = false;
    }
}

function formatDate(value: string | null): string {
    if (!value) return "—";
    return new Date(value).toLocaleString();
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-1 border-b border-zinc-800 pb-4">
                <div class="flex items-center justify-between gap-4 flex-wrap">
                    <h1 class="text-3xl font-bold text-white tracking-tight">
                        Shop Requests
                    </h1>
                    <div class="flex gap-2">
                        <button
                            class="px-4 py-2 border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500 hover:text-white transition-colors"
                            :disabled="pending"
                            @click="refresh()"
                        >
                            Refresh
                        </button>
                        <button
                            class="px-4 py-2 bg-white text-black text-sm font-bold hover:bg-zinc-200 transition-colors disabled:opacity-40"
                            :disabled="clusterBusy || requests.length === 0"
                            @click="runCluster"
                        >
                            {{ clusterBusy ? "Grouping..." : "Backfill AI groups" }}
                        </button>
                        <button
                            class="px-4 py-2 border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500 hover:text-white transition-colors disabled:opacity-40"
                            :disabled="dismissBackfillBusy || requests.length === 0"
                            @click="runDismissBackfill"
                        >
                            {{ dismissBackfillBusy ? "Dismissing..." : "Dismiss matched suggestions" }}
                        </button>
                    </div>
                </div>
                <p class="text-zinc-400 text-sm">
                    User-submitted shop item requests, sorted by votes and grouped by AI category. Backfill re-tags open requests from the last 14 days.
                </p>
            </div>

            <p
                v-if="clusterError"
                class="border border-red-500/20 bg-red-500/5 p-4 text-red-300 text-sm"
            >
                {{ clusterError }}
            </p>
            <p
                v-if="clusterResult"
                class="border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300 text-sm"
            >
                {{ clusterResult }}
            </p>
            <p
                v-if="dismissBackfillResult"
                class="border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300 text-sm"
            >
                {{ dismissBackfillResult }}
            </p>

            <div
                v-if="pending"
                class="border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-500 text-sm"
            >
                Loading requests...
            </div>
            <div
                v-else-if="error"
                class="border border-red-500/20 bg-red-500/5 p-6 text-red-300 text-sm"
            >
                Failed to load requests.
            </div>
            <div
                v-else-if="groups.length === 0"
                class="border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-500 text-sm"
            >
                No open shop requests.
            </div>

            <div v-else class="flex flex-col gap-4">
                <div
                    v-for="group in groups"
                    :key="group.key"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-start justify-between gap-3 flex-wrap">
                        <div class="min-w-0 flex flex-col gap-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h2 class="text-lg font-bold text-white">
                                    {{ group.group_tag ?? group.items[0]?.name ?? "Request" }}
                                </h2>
                                <span
                                    v-if="group.cluster_id != null"
                                    class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-blue-500/10 text-blue-300 border border-blue-500/20"
                                >
                                    Cluster #{{ group.cluster_id }}
                                </span>
                                <span
                                    class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-zinc-800 text-zinc-300 border border-zinc-700"
                                >
                                    {{ group.items.length }} request{{ group.items.length === 1 ? "" : "s" }}
                                </span>
                                <span
                                    class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                >
                                    {{ group.vote_count }} vote{{ group.vote_count === 1 ? "" : "s" }}
                                </span>
                            </div>
                            <p
                                v-if="group.items[0]?.description"
                                class="text-sm text-zinc-400 max-w-3xl"
                            >
                                Top request: {{ group.items[0]?.name }}<span v-if="group.items[0]?.description"> — {{ group.items[0]?.description }}</span>
                            </p>
                        </div>
                        <div class="flex gap-2">
                            <button
                                class="px-3 py-1.5 border border-zinc-700 text-zinc-300 text-xs hover:border-zinc-500 hover:text-white transition-colors disabled:opacity-40"
                                :disabled="group.items.some((i) => pricingBusy[i.id])"
                                @click="findPricing(group.items[0]!.id)"
                            >
                                {{ group.items.some((i) => pricingBusy[i.id]) ? "Looking..." : "Find stores & pricing" }}
                            </button>
                            <button
                                class="px-3 py-1.5 bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors"
                                @click="openPromote(group)"
                            >
                                Add to shop
                            </button>
                        </div>
                    </div>

                    <div v-if="group.items[0]?.pricing_info" class="flex flex-col gap-2">
                        <p class="text-xs text-zinc-500 uppercase tracking-wider font-bold">
                            AI-suggested stores (verify URLs before buying)
                        </p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <a
                                v-for="(store, idx) in group.items[0]!.pricing_info!.stores"
                                :key="idx"
                                :href="store.likely_url"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="flex items-center justify-between gap-3 border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-600 transition-colors"
                            >
                                <div class="min-w-0">
                                    <p class="text-sm font-bold text-white truncate">{{ store.store_name }}</p>
                                    <p v-if="store.notes" class="text-[11px] text-zinc-500 truncate">{{ store.notes }}</p>
                                </div>
                                <span
                                    v-if="store.estimated_price_usd != null"
                                    class="text-sm font-mono text-zinc-300 shrink-0"
                                >${{ store.estimated_price_usd.toFixed(2) }}</span>
                                <span v-else class="text-xs text-zinc-500 shrink-0">—</span>
                            </a>
                        </div>
                    </div>

                    <div class="flex flex-col gap-2">
                        <p class="text-xs text-zinc-500 uppercase tracking-wider font-bold">
                            Requesters
                        </p>
                        <div
                            v-for="item in group.items"
                            :key="item.id"
                            class="flex items-start justify-between gap-3 border-t border-zinc-800 pt-2"
                        >
                            <div class="flex items-center gap-3 min-w-0">
                                <img
                                    :src="item.user?.image || 'https://github.com/ghost.png'"
                                    class="w-8 h-8 rounded-full border border-zinc-700 bg-black object-cover shrink-0"
                                >
                                <div class="min-w-0">
                                    <p class="text-sm font-medium text-zinc-200 truncate">
                                        {{ item.user?.name ?? "Unknown" }}
                                    </p>
                                    <p class="text-[11px] text-zinc-500 truncate">
                                        #{{ item.id }} · {{ item.upvote_count }} vote{{ item.upvote_count === 1 ? "" : "s" }} · {{ formatDate(item.created_at) }}
                                        <span v-if="item.store_url">
                                            ·
                                            <a
                                                :href="item.store_url"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="text-blue-400 hover:text-blue-300 underline"
                                            >their link</a>
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <button
                                class="text-xs text-zinc-500 hover:text-red-400 transition-colors shrink-0 px-2 py-1 disabled:opacity-40"
                                :disabled="dismissBusy[item.id]"
                                @click="dismiss(item.id)"
                            >
                                {{ dismissBusy[item.id] ? "..." : "Dismiss" }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="dismissedRequests.length > 0" class="flex flex-col gap-4 pt-6 border-t border-zinc-800">
                <div class="flex flex-col gap-1">
                    <h2 class="text-2xl font-bold text-red-200 tracking-tight">Wall of Shame</h2>
                    <p class="text-sm text-zinc-500">Dismissed suggestions and why they were rejected. Older dismissals may not have a stored reason.</p>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div
                        v-for="item in dismissedRequests"
                        :key="`dismissed-${item.id}`"
                        class="border border-red-500/20 bg-red-500/5 p-4 flex flex-col gap-2"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="text-base font-bold text-white">{{ item.name }}</p>
                                <p class="text-xs text-zinc-500">#{{ item.id }} · {{ item.upvote_count }} vote{{ item.upvote_count === 1 ? "" : "s" }} · {{ formatDate(item.dismissed_at ?? item.created_at) }}</p>
                            </div>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-red-500/10 text-red-300 border border-red-500/20">Rejected</span>
                        </div>
                        <p v-if="item.description" class="text-sm text-zinc-400">{{ item.description }}</p>
                        <div class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-red-100">
                            {{ item.dismissed_reason || "No rejection reason stored on this older dismissal." }}
                        </div>
                    </div>
                </div>
            </div>

            <Teleport to="body">
                <Transition name="modal-fade">
                <div
                    v-if="promoteOpenFor != null"
                    class="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                    @click.self="closePromote"
                >
                    <div class="modal-fade-panel relative w-full max-w-2xl bg-zinc-950 border border-zinc-700 shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)] internal-modal-grid-bg">
                        <div class="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-800">
                            <h3 class="text-lg font-bold text-white">Promote request → shop item</h3>
                            <button class="text-zinc-500 hover:text-white" @click="closePromote">✕</button>
                        </div>
                        <form class="flex flex-col gap-4 px-5 py-4 overflow-y-auto" @submit.prevent="submitPromote">
                            <label class="flex flex-col gap-1">
                                <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Name</span>
                                <input
                                    v-model="promoteForm.name"
                                    type="text"
                                    required
                                    class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                >
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Description</span>
                                <textarea
                                    v-model="promoteForm.description"
                                    rows="3"
                                    class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
                                />
                            </label>
                            <label class="flex flex-col gap-1">
                                <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Image URL</span>
                                <input
                                    v-model="promoteForm.imageUrl"
                                    type="url"
                                    class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                >
                            </label>
                            <div class="grid grid-cols-2 gap-3">
                                <label class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Kind</span>
                                    <select
                                        v-model="promoteForm.kind"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                        <option value="physical">Physical</option>
                                        <option value="grant">Grant</option>
                                        <option value="virtual_service">Virtual Service</option>
                                    </select>
                                </label>
                                <label class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Fulfillment</span>
                                    <select
                                        v-model="promoteForm.fulfillmentProvider"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                        <option v-if="promoteForm.kind !== 'grant'" value="internal">
                                            {{ promoteForm.kind === "virtual_service" ? "Internal (auto-activated)" : "Internal" }}
                                        </option>
                                        <option v-if="promoteForm.kind === 'physical'" value="theseus">Theseus</option>
                                        <option v-if="promoteForm.kind === 'grant'" value="hcb">HCB</option>
                                    </select>
                                </label>
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <label class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Base price (gold)</span>
                                    <input
                                        v-model.number="promoteForm.priceGold"
                                        type="number"
                                        min="0"
                                        required
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                </label>
                                <label v-if="promoteForm.kind === 'grant'" class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Grant amount (USD)</span>
                                    <input
                                        v-model.number="promoteForm.grantAmountDollars"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                </label>
                                <label v-else class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Stock (blank = unlimited)</span>
                                    <input
                                        v-model.number="promoteForm.stockRemaining"
                                        type="number"
                                        min="0"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                </label>
                            </div>
                            <div class="grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
                                <label class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">NA region price (gold)</span>
                                    <input
                                        v-model.number="promoteForm.naRegionPriceGold"
                                        type="number"
                                        min="0"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                </label>
                                <label class="flex flex-col gap-1">
                                    <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">NA store URL</span>
                                    <input
                                        v-model="promoteForm.storeUrl"
                                        type="url"
                                        class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                                    >
                                </label>
                            </div>

                            <p v-if="promoteError" class="text-sm text-red-400 border border-red-500/30 bg-red-500/10 px-3 py-2">
                                {{ promoteError }}
                            </p>
                        </form>
                        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800 bg-zinc-900/60">
                            <button
                                type="button"
                                class="px-4 py-2 border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500 hover:text-white transition-colors"
                                @click="closePromote"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                class="px-4 py-2 bg-white text-black text-sm font-bold hover:bg-zinc-200 transition-colors disabled:opacity-40"
                                :disabled="promoteBusy"
                                @click="submitPromote"
                            >
                                {{ promoteBusy ? "Creating..." : "Create shop item" }}
                            </button>
                        </div>
                    </div>
                </div>
                </Transition>
            </Teleport>
        </div>
    </div>
</template>
