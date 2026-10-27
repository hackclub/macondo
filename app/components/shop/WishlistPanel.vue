<script setup lang="ts">
import { Check, ChevronDown, ChevronUp, Clock, GripVertical, Minus, Plus, Star, X } from "lucide-vue-next";
import { formatGold } from "~/utils/formatGold";

// Kept local so the panel doesn't couple to the full ShopItem type in shop.vue
type WishlistItem = {
    id: number;
    name: string;
    image_url: string | null;
    price_gold: number;
    available_in_region?: boolean;
};

const props = defineProps<{
    items: WishlistItem[];
    gold: number;
    goldPerHour: number | null;
}>();

const emit = defineEmits<{ unstar: [id: number] }>();

const QTY_KEY = "macondo_wishlist_qty";
const ORDER_KEY = "macondo_wishlist_order";

// Client-side only: personal planning niceties that don't warrant a schema change (stars are server-backed)
const quantities = ref<Record<number, number>>({});
const order = ref<number[]>([]);

onMounted(() => {
    quantities.value = readJson<Record<number, number>>(QTY_KEY, {});
    const rawOrder = readJson<number[]>(ORDER_KEY, []);
    order.value = Array.isArray(rawOrder)
        ? rawOrder.filter((n) => Number.isInteger(n))
        : [];
});

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}
function writeJson(key: string, value: unknown) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore storage failures (private mode, quota).
    }
}

function qty(id: number): number {
    const v = quantities.value[id];
    return typeof v === "number" && Number.isFinite(v) && v >= 1
        ? Math.min(999, Math.floor(v))
        : 1;
}
function setQty(id: number, value: number) {
    quantities.value = { ...quantities.value, [id]: Math.min(999, Math.max(1, Math.floor(value))) };
    writeJson(QTY_KEY, quantities.value);
}

// Items without a saved position fall to the end (newest stars land last until dragged)
const orderedItems = computed(() => {
    const idx = new Map(order.value.map((id, i) => [id, i]));
    return [...props.items].sort((a, b) => {
        return (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    });
});

const draggingId = ref<number | null>(null);
function onDragStart(id: number) {
    draggingId.value = id;
}
function onDragEnd() {
    draggingId.value = null;
}
function onDrop(targetId: number) {
    const from = draggingId.value;
    draggingId.value = null;
    if (from == null || from === targetId) return;
    const ids = orderedItems.value.map((i) => i.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, from);
    order.value = ids;
    writeJson(ORDER_KEY, ids);
}

const collapsed = ref(false);
type ViewMode = "individual" | "cumulative";
const viewMode = ref<ViewMode>("cumulative");

function itemCost(item: WishlistItem): number {
    return item.price_gold * qty(item.id);
}
function itemProgress(item: WishlistItem): number {
    const cost = itemCost(item);
    if (cost <= 0) return 1;
    return Math.max(0, Math.min(1, props.gold / cost));
}
function isItemAffordable(item: WishlistItem): boolean {
    return props.gold >= itemCost(item);
}
// Hours to afford this item alone; null when the rate is unknown, 0 when already affordable
function itemHours(item: WishlistItem): number | null {
    const rate = props.goldPerHour;
    if (rate == null || rate <= 0) return null;
    const deficit = itemCost(item) - props.gold;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / rate);
}

// Hours to afford each item when saving for the list in order (running total vs current gold)
const projectedHoursById = computed(() => {
    const map = new Map<number, number | null>();
    const rate = props.goldPerHour;
    let running = 0;
    for (const item of orderedItems.value) {
        running += itemCost(item);
        if (rate == null || rate <= 0) {
            map.set(item.id, null);
            continue;
        }
        const deficit = running - props.gold;
        map.set(item.id, deficit <= 0 ? 0 : Math.ceil(deficit / rate));
    }
    return map;
});

const totalCost = computed(() =>
    props.items.reduce((sum, item) => sum + itemCost(item), 0),
);
const cumulativeProgress = computed(() => {
    if (totalCost.value <= 0) return 1;
    return Math.max(0, Math.min(1, props.gold / totalCost.value));
});
const cumulativeHours = computed<number | null>(() => {
    const rate = props.goldPerHour;
    if (rate == null || rate <= 0) return null;
    const deficit = totalCost.value - props.gold;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / rate);
});
const affordableCount = computed(
    () => props.items.filter((item) => isItemAffordable(item)).length,
);
</script>

<template>
    <div>
        <div class="flex items-center justify-between gap-3 flex-wrap">
            <button
                type="button"
                class="flex items-center gap-2"
                @click="collapsed = !collapsed"
            >
                <Star class="w-5 h-5 fill-ds-brown text-ds-brown shrink-0" />
                <span class="text-lg font-bold text-ds-brown">{{ $t("shop_page.wishlist.title") }}</span>
                <span class="text-xs font-bold text-ds-brown/55 uppercase tracking-wide">
                    {{ $t("shop_page.wishlist.item_count", { count: items.length }) }}
                </span>
                <component :is="collapsed ? ChevronDown : ChevronUp" class="w-4 h-4 text-ds-brown/60" />
            </button>
            <div v-if="!collapsed" class="flex items-center border-[2px] border-ds-brown/30">
                <button
                    type="button"
                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors"
                    :class="viewMode === 'cumulative' ? 'bg-ds-brown text-ds-cream' : 'text-ds-brown/70 hover:bg-ds-brown/10'"
                    @click="viewMode = 'cumulative'"
                >
                    {{ $t("shop_page.wishlist.view_cumulative") }}
                </button>
                <button
                    type="button"
                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors"
                    :class="viewMode === 'individual' ? 'bg-ds-brown text-ds-cream' : 'text-ds-brown/70 hover:bg-ds-brown/10'"
                    @click="viewMode = 'individual'"
                >
                    {{ $t("shop_page.wishlist.view_individual") }}
                </button>
            </div>
        </div>

        <div v-if="!collapsed" class="mt-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div
                    v-for="item in orderedItems"
                    :key="item.id"
                    class="flex flex-col gap-2 border-[2px] border-ds-brown/20 bg-white/45 p-2.5 transition-opacity"
                    :class="[
                        item.available_in_region === false && 'opacity-60 grayscale',
                        draggingId === item.id && 'opacity-40',
                    ]"
                    draggable="true"
                    @dragstart="onDragStart(item.id)"
                    @dragend="onDragEnd"
                    @dragover.prevent
                    @drop="onDrop(item.id)"
                >
                    <div class="flex items-start gap-2">
                        <GripVertical
                            class="mt-0.5 w-3.5 h-3.5 shrink-0 text-ds-brown/35 cursor-grab active:cursor-grabbing"
                            :title="$t('shop_page.wishlist.drag_hint')"
                        />
                        <div class="w-10 h-10 shrink-0 bg-[#ecd2ae] flex items-center justify-center overflow-hidden">
                            <img
                                v-if="item.image_url"
                                :src="item.image_url"
                                :alt="item.name"
                                class="w-full h-full object-contain p-1"
                                draggable="false"
                            >
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-start justify-between gap-1">
                                <span class="font-bold text-ds-brown text-sm leading-tight line-clamp-2">{{ item.name }}</span>
                                <button
                                    type="button"
                                    class="-mt-0.5 -mr-0.5 shrink-0 p-0.5 text-ds-brown/50 hover:text-ds-danger transition-colors"
                                    :aria-label="$t('shop_page.wishlist.remove')"
                                    @click="emit('unstar', item.id)"
                                >
                                    <X class="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <span class="mt-0.5 flex items-center gap-1 text-xs font-bold text-ds-brown">
                                <img src="/images/icons/money.webp" class="w-3.5 h-3.5 object-contain" alt="">
                                {{ item.price_gold }}
                            </span>
                        </div>
                    </div>

                    <div class="h-2 bg-ds-brown/15 overflow-hidden">
                        <div
                            class="h-full transition-[width] duration-500"
                            :class="isItemAffordable(item) ? 'bg-ds-success' : 'bg-ds-brown'"
                            :style="{ width: `${Math.round(itemProgress(item) * 100)}%` }"
                        />
                    </div>

                    <div class="flex items-center justify-between gap-2">
                        <!-- Individual: this item alone. Cumulative: time to afford it saving the list in order. -->
                        <span
                            v-if="isItemAffordable(item)"
                            class="flex items-center gap-1 min-w-0 truncate text-[11px] font-bold text-ds-success"
                        >
                            <Check class="w-3 h-3 shrink-0" /> {{ $t("shop_page.wishlist.affordable_badge") }}
                        </span>
                        <template v-else-if="viewMode === 'individual'">
                            <span
                                v-if="itemHours(item) != null"
                                class="flex items-center gap-1 min-w-0 truncate text-[11px] font-bold text-ds-brown/60"
                            >
                                <Clock class="w-3 h-3 shrink-0" /> {{ $t("shop_page.wishlist.to_go", { hours: itemHours(item) }) }}
                            </span>
                            <span v-else />
                        </template>
                        <template v-else>
                            <span
                                v-if="projectedHoursById.get(item.id) === 0"
                                class="flex items-center gap-1 min-w-0 truncate text-[11px] font-bold text-ds-success"
                            >
                                <Check class="w-3 h-3 shrink-0" /> {{ $t("shop_page.wishlist.in_order_ready") }}
                            </span>
                            <span
                                v-else-if="projectedHoursById.get(item.id) != null"
                                class="flex items-center gap-1 min-w-0 truncate text-[11px] font-bold text-ds-brown/60"
                            >
                                <Clock class="w-3 h-3 shrink-0" /> {{ $t("shop_page.wishlist.in_order", { hours: projectedHoursById.get(item.id) }) }}
                            </span>
                            <span v-else />
                        </template>
                        <div class="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                class="p-1 border-[2px] border-ds-brown/25 text-ds-brown hover:bg-ds-brown/10 disabled:opacity-40"
                                :disabled="qty(item.id) <= 1"
                                :aria-label="$t('shop_page.wishlist.decrease')"
                                @click="setQty(item.id, qty(item.id) - 1)"
                            >
                                <Minus class="w-3 h-3" />
                            </button>
                            <span class="min-w-[1.5rem] text-center text-xs font-bold text-ds-brown">{{ qty(item.id) }}</span>
                            <button
                                type="button"
                                class="p-1 border-[2px] border-ds-brown/25 text-ds-brown hover:bg-ds-brown/10 disabled:opacity-40"
                                :disabled="qty(item.id) >= 999"
                                :aria-label="$t('shop_page.wishlist.increase')"
                                @click="setQty(item.id, qty(item.id) + 1)"
                            >
                                <Plus class="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="mt-3 border-[2px] border-ds-brown/25 bg-ds-brown/5 p-3 flex flex-col gap-2">
                <template v-if="viewMode === 'cumulative'">
                    <div class="flex items-center justify-between text-sm font-bold text-ds-brown">
                        <span>{{ $t("shop_page.wishlist.total_cost") }}</span>
                        <span class="flex items-center gap-1">
                            <img src="/images/icons/money.webp" class="w-4 h-4 object-contain" alt="">
                            {{ formatGold(totalCost) }}
                        </span>
                    </div>
                    <div class="h-2.5 bg-ds-brown/15 overflow-hidden">
                        <div
                            class="h-full transition-[width] duration-500"
                            :class="cumulativeProgress >= 1 ? 'bg-ds-success' : 'bg-ds-brown'"
                            :style="{ width: `${Math.round(cumulativeProgress * 100)}%` }"
                        />
                    </div>
                    <p
                        v-if="cumulativeProgress >= 1 || cumulativeHours === 0"
                        class="text-xs font-bold text-ds-success"
                    >
                        {{ $t("shop_page.wishlist.all_affordable") }}
                    </p>
                    <p
                        v-else-if="cumulativeHours != null"
                        class="flex items-center gap-1 text-xs font-bold text-ds-brown/65"
                    >
                        <Clock class="w-3 h-3 shrink-0" />
                        {{ $t("shop_page.wishlist.to_afford_all", { hours: cumulativeHours }) }}
                    </p>
                </template>
                <template v-else>
                    <p class="text-sm font-bold text-ds-brown flex items-center gap-2">
                        <Check class="w-4 h-4 text-ds-success shrink-0" />
                        {{ $t("shop_page.wishlist.ready_count", { ready: affordableCount, total: items.length }) }}
                    </p>
                </template>
            </div>
        </div>
    </div>
</template>
