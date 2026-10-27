<script setup lang="ts">
import { AlertTriangle, Award, Clock, HelpCircle, MapPin, PartyPopper, Star, TrendingUp } from "lucide-vue-next";
import { formatGold, formatGoldCompact } from "~/utils/formatGold";
import { shopHourDisplay } from "~/utils/shopHourDisplay";
import { clampPurchaseQuantity } from "~/utils/shopQuantity";
import { SHOP_ITEM_CATEGORIES } from "~/data/shopCategories";

let gsapPromise: Promise<{
  gsap: typeof import("gsap").gsap;
  Flip: typeof import("gsap/Flip").Flip;
}> | null = null;
function loadGsap() {
  if (!gsapPromise) {
    gsapPromise = Promise.all([
      import("gsap"),
      import("gsap/Flip"),
    ]).then(([gsapMod, flipMod]) => {
      gsapMod.gsap.registerPlugin(flipMod.Flip);
      return { gsap: gsapMod.gsap, Flip: flipMod.Flip };
    });
  }
  return gsapPromise;
}

const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

// The glow ring is a box-shadow (paint-only), so it never adds scrollbars on the rightmost cards.
function playFavoriteAnimation(btn: HTMLElement) {
    if (prefersReducedMotion()) return;
    void loadGsap().then(({ gsap }) => {

    // Modest overshoot so the corner button doesn't poke past the card and force a horizontal scroll.
    gsap.fromTo(
        btn,
        { scale: 0.7 },
        { scale: 1, duration: 0.4, ease: "back.out(1.4)", overwrite: "auto" },
    );

    gsap.fromTo(
        btn,
        { boxShadow: "0 0 0 0px rgba(238, 176, 17, 0.85)" },
        {
            boxShadow: "0 0 0 14px rgba(238, 176, 17, 0)",
            duration: 0.55,
            ease: "power2.out",
            onComplete: () => {
                btn.style.boxShadow = "";
            },
        },
    );
    });
}

definePageMeta({
    layout: false,
});

const { isLoggedIn, user, signIn } = useAuth();
const ownedFreezes = computed(() => user.value?.streak_freezes_remaining ?? 0);

const props = defineProps<{
    embeddedWindowed?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const isWindowed = computed(() => props.embeddedWindowed || route.query.windowed === "1");

function closeModal() {
    if (props.embeddedWindowed) {
        emit("close");
    } else if (import.meta.client) {
        window.parent.postMessage({ type: "close-modal" }, "*");
    }
}
type ShopRegion = "NA" | "SA" | "BR" | "EU" | "AS" | "IN" | "OC" | "AF" | "ME";

const REGION_LABELS: Record<ShopRegion, string> = {
    NA: "North America",
    SA: "South America",
    BR: "Brazil",
    EU: "Europe",
    AS: "Asia",
    IN: "India",
    OC: "Oceania",
    AF: "Africa",
    ME: "Middle East",
};

type ShopItemModifierOption = {
    id: string;
    label: string;
    label_translations?: Record<string, string>;
    price_delta_hours: number;
};

type ShopItemModifier = {
    id: string;
    label: string;
    label_translations?: Record<string, string>;
    type: "single" | "multi" | "text";
    required?: boolean;
    options: ShopItemModifierOption[];
    // Text-modifier fields (type "text" only).
    max_length?: number;
    placeholder?: string;
    placeholder_translations?: Record<string, string>;
    price_delta_hours?: number;
};

type ShopItem = {
    id: number;
    slug?: string | null;
    name: string;
    description: string | null;
    image_url: string | null;
    kind: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillment_provider: "internal" | "theseus" | "hcb" | "internal_synthetic";
    source?: "hq" | "local" | null;
    price_gold: number;
    price_hours: number;
    // Pre-sale price for the strikethrough; equals price_gold when not on sale.
    regular_price_gold?: number;
    is_on_sale?: boolean;
    grant_amount_cents: number | null;
    attachment_urls: string[];
    inventory_mode: "unlimited" | "limited";
    stock_remaining: number | null;
    max_per_user?: number | null;
    max_quantity_per_order?: number | null;
    user_purchased_count?: number;
    hit_per_user_cap?: boolean;
    available_until: string | null;
    available: boolean;
    coming_soon: boolean;
    is_expired: boolean;
    is_sold_out: boolean;
    is_purchasable: boolean;
    available_in_region?: boolean;
    resolved_region?: ShopRegion | null;
    requires_shipped_project?: boolean;
    blocked_no_shipped_project?: boolean;
    // Pinned items render above everything and ignore the filters and sort.
    pinned?: boolean;
    // Server-computed in server/routes/_ui/c/[k].get.ts; mutated optimistically on toggle.
    starred?: boolean;
    // is_locked: server-computed, true when extra_fruity and not yet unlocked (always for guests).
    extra_fruity?: boolean;
    user_has_unlocked?: boolean;
    is_locked?: boolean;
    modifiers?: ShopItemModifier[] | null;
    category?: string | null;
};

type ShopItemsResponse = {
    items: ShopItem[];
    region: ShopRegion;
    user_has_shipped_project?: boolean | null;
    under_renovation?: boolean;
};

type ShippingAddress = {
    firstName: string;
    lastName: string;
    address1: string;
    address2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
};

type CheckoutAddressOption = {
    id: string;
    label: string;
    primary: boolean;
    shippingAddress: ShippingAddress;
    phone: string | null;
};

type CheckoutAddress = {
    addresses: CheckoutAddressOption[];
    shippingAddress: ShippingAddress;
    phone: string | null;
};

type EventStatusResponse = {
    approvedHours: number;
    qualifyHours: number;
    autoQualified: boolean;
    alreadyPurchased: boolean;
    hasCertificate: boolean;
    certificateCode: string | null;
    // Includes hardware gold still awaiting build proof (see server/api/event/status.get.ts).
    gold: number;
};

const shopNuxtApp = useNuxtApp();
function shopReuseCachedData<T>(key: string) {
    return ((_k: string, app: typeof shopNuxtApp, ctx?: { cause?: string }): T | undefined => {
        // With granularCachedData, refresh() also consults getCachedData, so bail out on refresh
        // causes (like Nuxt's getDefaultCachedData) or manual refreshes never hit the network.
        if (ctx?.cause === "refresh:manual" || ctx?.cause === "refresh:hook") {
            return undefined;
        }
        return ((app.payload.data?.[key] ?? app.static.data?.[key]) ?? undefined) as T | undefined;
    }) as unknown as (key: string, app: typeof shopNuxtApp, ctx: { cause: string }) => T | undefined;
}

const {
    data: balanceData,
    refresh: refreshBalance,
} = await useFetch<{ balance: number }>("/api/users/balance", {
    key: "shop-balance",
    // lazy: an awaited client fetch would block the async <script setup> until every fetch resolves.
    lazy: true,
    default: () => ({ balance: 0 }),
    server: false,
    getCachedData: shopReuseCachedData<{ balance: number }>("shop-balance"),
});
const gold = computed(() => balanceData.value?.balance ?? 0);

// Shared with the dashboard HUD so unlocks and ships update both without a round trip.
const { balance: sharedStarfruitBalance, refresh: refreshStarfruit, setBalance: setSharedStarfruitBalance } = useStarfruitBalance();
const {
    data: starfruitData,
} = await useFetch<{ balance: number }>("/api/users/starfruit", {
    key: "shop-starfruit",
    lazy: true,
    default: () => ({ balance: 0 }),
    server: false,
    getCachedData: shopReuseCachedData<{ balance: number }>("shop-starfruit"),
});
watch(
    () => starfruitData.value?.balance,
    (next) => {
        if (typeof next === "number") setSharedStarfruitBalance(next);
    },
    { immediate: true },
);
const starfruit = computed(() => sharedStarfruitBalance.value);

// The endpoint 401s for guests (the default covers it); gold_per_hour is null until the first ship.
const {
    data: earningRateData,
} = await useFetch<{
    has_shipped: boolean;
    gold_per_hour: number | null;
    fruit_per_hour: number | null;
}>("/api/users/earning-rate", {
    key: "shop-earning-rate",
    lazy: true,
    default: () => ({ has_shipped: false, gold_per_hour: null, fruit_per_hour: null }),
    server: false,
    getCachedData: shopReuseCachedData<{
        has_shipped: boolean;
        gold_per_hour: number | null;
        fruit_per_hour: number | null;
    }>("shop-earning-rate"),
});
const earningRate = computed(() => earningRateData.value);

// server: false is load-bearing: SSR would serialize the whole catalog into the page's
// __NUXT__ payload, readable without auth, bypassing the catalog endpoint's gate.
const shopCatalog = useShopCatalog();
const {
    data: shopItemsResponse,
    pending: loadingShopItems,
    refresh: refreshShopItems,
} = await useAsyncData<ShopItemsResponse>(
    "shop-items",
    () => shopCatalog.fetch<ShopItemsResponse>(),
    {
        server: false,
        default: () => ({ items: [], region: "NA" as ShopRegion }),
        getCachedData: shopReuseCachedData<ShopItemsResponse>("shop-items"),
    },
);

// Always replace the whole Set (never mutate it) so the ref reliably triggers re-renders.
const starredItemIds = ref<Set<number>>(new Set());
watch(
    shopItemsResponse,
    (response) => {
        const next = new Set<number>();
        for (const item of response?.items ?? []) {
            if (item.starred === true && typeof item.id === "number") {
                next.add(item.id);
            }
        }
        starredItemIds.value = next;
    },
    { immediate: true },
);
function isItemStarred(item: ShopItem): boolean {
    return typeof item.id === "number" && starredItemIds.value.has(item.id);
}

const shopGridRef = ref<HTMLElement | null>(null);

function onModalEnter(el: Element, done: () => void) {
    if (prefersReducedMotion()) {
        done();
        return;
    }
    void loadGsap().then(({ gsap }) => gsap.fromTo(
        el as HTMLElement,
        { scale: 0.96, opacity: 0 },
        {
            scale: 1,
            opacity: 1,
            duration: 0.28,
            ease: "back.out(1.6)",
            onComplete: done,
        },
    ));
}

async function toggleStar(item: ShopItem, event?: Event) {
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (typeof item.id !== "number") return;
    const itemId = item.id;

    const btn = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (btn) playFavoriteAnimation(btn);

    // Neutralize the cards' CSS transform transition before capturing, or it fights GSAP's
    // FLIP transforms and the cards teleport instead of animating.
    const grid = shopGridRef.value;
    const cards = grid && !prefersReducedMotion()
        ? Array.from(grid.children) as HTMLElement[]
        : null;
    if (cards) {
        for (const el of cards) {
            el.style.transition = "none";
            el.style.transform = "none";
        }
    }
    const flipState = cards ? (await loadGsap()).Flip.getState(cards) : null;
    const wasStarred = starredItemIds.value.has(itemId);
    const next = new Set(starredItemIds.value);
    if (wasStarred) next.delete(itemId);
    else next.add(itemId);
    starredItemIds.value = next;

    if (flipState && cards) {
        await nextTick();
        const { Flip } = await loadGsap();
        Flip.from(flipState, {
            duration: 0.45,
            ease: "power2.inOut",
            onComplete: () => {
                for (const el of cards) {
                    el.style.transition = "";
                    el.style.transform = "";
                }
            },
        });
    } else if (cards) {
        // Reduced motion: still restore the inline overrides so hover styles work.
        for (const el of cards) {
            el.style.transition = "";
            el.style.transform = "";
        }
    }

    try {
        await $fetch(`/api/shop/items/${itemId}/star`, {
            method: wasStarred ? "DELETE" : "PUT",
        });
    } catch (e) {
        const rollback = new Set(starredItemIds.value);
        if (wasStarred) rollback.add(itemId);
        else rollback.delete(itemId);
        starredItemIds.value = rollback;
        console.error("Failed to toggle star", e);
    }
}

const shopItems = computed(() => shopItemsResponse.value?.items ?? []);
const shopUnderRenovation = computed(
    () => shopItemsResponse.value?.under_renovation === true,
);
const resolvedRegion = computed<ShopRegion>(
    () => (shopItemsResponse.value?.region as ShopRegion) ?? "NA",
);
const regionOverrideSaving = ref(false);

async function changeRegion(nextRegion: ShopRegion) {
    if (nextRegion === resolvedRegion.value) return;
    regionOverrideSaving.value = true;
    try {
        await $fetch("/api/user/region-override", {
            method: "PATCH",
            body: { region: nextRegion },
        });
        await refreshShopItems();
    } catch (e) {
        console.error("Failed to update region override", e);
    } finally {
        regionOverrideSaving.value = false;
    }
}

// Defaults to price_asc since most sessions start with "what can I afford". Embedded, the URL
// belongs to dashboard.vue, whose query watchers would close the modal, so skip the sync.
type SortKey = "featured" | "price_asc" | "price_desc" | "name_asc" | "name_desc";
function parseSortKey(raw: unknown): SortKey {
    if (
        raw === "price_asc" ||
        raw === "price_desc" ||
        raw === "featured" ||
        raw === "name_asc" ||
        raw === "name_desc"
    ) {
        return raw;
    }
    return "price_asc";
}
const sortKey = ref<SortKey>(parseSortKey(route.query.sort));
watch(sortKey, (value) => {
    if (isWindowed.value) return;
    const nextQuery = { ...route.query };
    if (value === "featured") {
        delete nextQuery.sort;
    } else {
        nextQuery.sort = value;
    }
    void navigateTo({ path: route.path, query: nextQuery }, { replace: true });
});

// Pinned items ignore these filters, as they ignore the sort.
const filterAffordable = ref(false);
const filterUnlocked = ref(false);
const categoryFilter = ref<string | null>(null);
const availableCategories = computed(() => {
    const present = new Set(
        shopItems.value.map((item) => item.category).filter((c): c is string => !!c),
    );
    return SHOP_ITEM_CATEGORIES.filter((c) => present.has(c));
});
function canBuyNow(item: ShopItem): boolean {
    return (
        item.is_purchasable === true &&
        item.available_in_region !== false &&
        item.hit_per_user_cap !== true &&
        item.is_locked !== true &&
        item.blocked_no_shipped_project !== true &&
        gold.value >= item.price_gold
    );
}
function matchesShopFilters(item: ShopItem): boolean {
    if (filterAffordable.value && !canBuyNow(item)) return false;
    if (filterUnlocked.value && item.is_locked === true) return false;
    if (categoryFilter.value && item.category !== categoryFilter.value) return false;
    return true;
}

// Capture positions before the sort recomputes, then Flip once Vue applies the new order.
watch(
    () => [sortKey.value, filterAffordable.value, filterUnlocked.value, categoryFilter.value],
    async () => {
        const grid = shopGridRef.value;
        if (!grid || prefersReducedMotion()) return;
        const cards = Array.from(grid.children) as HTMLElement[];
        // Same neutralize-transition trick as toggleStar.
        for (const el of cards) {
            el.style.transition = "none";
            el.style.transform = "none";
        }
        const { Flip, gsap } = await loadGsap();
        const state = Flip.getState(cards);
        await nextTick();
        Flip.from(state, {
            duration: 0.4,
            ease: "power2.inOut",
            onEnter: (els) =>
                gsap.fromTo(
                    els,
                    { opacity: 0, scale: 0.94 },
                    { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" },
                ),
            onLeave: (els) =>
                gsap.to(els, { opacity: 0, scale: 0.94, duration: 0.25 }),
            onComplete: () => {
                for (const el of cards) {
                    el.style.transition = "";
                    el.style.transform = "";
                }
            },
        });
    },
);
const sortedShopItems = computed(() => {
    const all = shopItems.value;
    const pinned = all.filter((item) => item.pinned === true);
    const unpinned = all.filter((item) => item.pinned !== true).filter(matchesShopFilters);
    const sortList = (arr: ShopItem[]) => {
        if (sortKey.value === "price_asc") {
            return arr.sort((a, b) => (a.price_gold ?? 0) - (b.price_gold ?? 0));
        }
        if (sortKey.value === "price_desc") {
            return arr.sort((a, b) => (b.price_gold ?? 0) - (a.price_gold ?? 0));
        }
        if (sortKey.value === "name_asc") {
            return arr.sort((a, b) => a.name.localeCompare(b.name));
        }
        if (sortKey.value === "name_desc") {
            return arr.sort((a, b) => b.name.localeCompare(a.name));
        }
        return arr;
    };
    // Starred items rise, but a starred unavailable item stays among the unavailable ones.
    const starredAvailable = unpinned.filter(
        (item) => isItemStarred(item) && item.available_in_region !== false,
    );
    const starredUnavailable = unpinned.filter(
        (item) => isItemStarred(item) && item.available_in_region === false,
    );
    const unstarredAvailable = unpinned.filter(
        (item) => !isItemStarred(item) && item.available_in_region !== false,
    );
    const unstarredUnavailable = unpinned.filter(
        (item) => !isItemStarred(item) && item.available_in_region === false,
    );
    return [
        ...pinned,
        ...sortList(starredAvailable),
        ...sortList(starredUnavailable),
        ...sortList(unstarredAvailable),
        ...sortList(unstarredUnavailable),
    ];
});

const starredShopItems = computed(() =>
    shopItems.value.filter((item) => isItemStarred(item)),
);
function unstarFromWishlist(id: number) {
    const item = shopItems.value.find((entry) => entry.id === id);
    if (item) void toggleStar(item);
}

// Hours of work to close the gold gap at the viewer's realized rate; null until they've shipped.
function shopTimeToEarn(item: ShopItem): { affordable: boolean; hours: number } | null {
    const rate = earningRate.value?.gold_per_hour;
    if (rate == null || rate <= 0) return null;
    const deficit = item.price_gold - gold.value;
    if (deficit <= 0) return { affordable: true, hours: 0 };
    return { affordable: false, hours: Math.ceil(deficit / rate) };
}

// Keep "event_invite" in sync with EVENT_INVITE_SLUG in server/lib/shop.ts (not importable here).
const eventBarItem = computed(
    () => shopItems.value.find((item) => item.slug === "event_invite") ?? null,
);

// A standard rate so everyone sees the same figure (1000 gold / 50 = 20h). Not price_hours (a
// pricing unit) nor the viewer's own rate; keep in sync with the seat's hours target.
const eventBarHours = computed(() => {
    const item = eventBarItem.value;
    if (!item || item.price_gold <= 0) return null;
    if (gold.value >= item.price_gold) {
        return { personalized: false, affordable: true, hours: 0 };
    }
    // With no gold this is the full figure, used as the generic "around N hours earns a seat".
    return {
        personalized: gold.value > 0,
        affordable: false,
        hours: Math.max(1, Math.ceil((item.price_gold - gold.value) / 50)), // event ticket gold per hour
    };
});

// Same endpoint as the dashboard event widget, so the two can never disagree.
const {
    data: eventStatusData,
} = await useFetch<EventStatusResponse>("/api/event/status", {
    key: "shop-event-status",
    lazy: true,
    default: () => null,
    server: false,
    getCachedData: shopReuseCachedData<EventStatusResponse | null>("shop-event-status"),
});
const eventStatus = computed(() => eventStatusData.value);

// These items accept gold pending build proof (staff void it at the event). Keep in sync with
// canPurchaseWithPendingGold in server/lib/shop.ts.
const PENDING_GOLD_SLUGS = new Set([
    "event_invite",
    "travel_stipend",
    "pre_event_accommodation",
    "post_event_accommodation",
]);
const eventSpendableGold = computed(() => eventStatus.value?.gold ?? gold.value);

// Approved hours auto-qualify a maker for a free seat; gold counts toward the ticket price.
const eventHoursProgress = computed(() => {
    const status = eventStatus.value;
    if (!isLoggedIn.value || !status || status.qualifyHours <= 0) return null;
    return {
        earned: Math.round(status.approvedHours * 10) / 10,
        total: status.qualifyHours,
        pct: Math.round((Math.min(status.approvedHours, status.qualifyHours) / status.qualifyHours) * 100),
    };
});

const eventGoldProgress = computed(() => {
    const item = eventBarItem.value;
    if (!isLoggedIn.value || !item || item.price_gold <= 0) return null;
    return {
        earned: eventSpendableGold.value,
        total: item.price_gold,
        pct: Math.round((Math.min(eventSpendableGold.value, item.price_gold) / item.price_gold) * 100),
    };
});

// The gold path stays open the whole time: hitting the hours threshold makes
// the seat free, but anyone holding the full price can just buy it today.
const eventCanAfford = computed(() => {
    const item = eventBarItem.value;
    if (!isLoggedIn.value || !item || item.price_gold <= 0) return false;
    return eventSpendableGold.value >= item.price_gold;
});

const {
    data: checkoutAddressData,
    refresh: refreshCheckoutAddress,
} = await useFetch<CheckoutAddress | null>("/api/shop/address", {
    key: "shop-address",
    lazy: true,
    default: () => null,
    server: false,
    getCachedData: shopReuseCachedData<CheckoutAddress | null>("shop-address"),
});

const {
    data: pendingAddressData,
    refresh: refreshPendingAddress,
} = await useFetch<{ count: number; needs_hca_link: boolean }>(
    "/api/shop/pending-address-orders",
    {
        key: "shop-pending-address",
        lazy: true,
        default: () => ({ count: 0, needs_hca_link: false }),
        server: false,
        getCachedData: shopReuseCachedData<{ count: number; needs_hca_link: boolean }>("shop-pending-address"),
    },
);
const pendingAddressSyncing = ref(false);
const pendingAddressMessage = ref("");

async function syncPendingAddress() {
    const { t } = useNuxtApp().$i18n as { t: (key: string, params?: Record<string, unknown>) => string };
    pendingAddressSyncing.value = true;
    pendingAddressMessage.value = "";
    try {
        const res = await $fetch<{
            synced: boolean;
            reason?: string;
            needs_reauth?: boolean;
            updated_orders?: number;
        }>("/api/hca/sync", { method: "POST" });
        if (res.synced) {
            pendingAddressMessage.value = res.updated_orders && res.updated_orders > 0
                ? t("shop_page.sync_updated", { count: res.updated_orders })
                : t("shop_page.sync_none");
            await refreshPendingAddress();
        } else if (res.needs_reauth) {
            window.location.href = "/api/shop/address/login?return_to=/shop";
            return;
        } else if (res.reason === "not_linked") {
            pendingAddressMessage.value = t("shop_page.sync_not_linked");
        } else {
            pendingAddressMessage.value = t("shop_page.sync_failed_retry");
        }
    } catch {
        pendingAddressMessage.value = t("shop_page.sync_failed");
    } finally {
        pendingAddressSyncing.value = false;
    }
}

type MyOrderStatus =
    | "pending_internal_fulfillment"
    | "shipped"
    | "service_activated"
    | "grant_pending"
    | "grant_created"
    | "theseus_submitted"
    | "external_failure"
    | "cancelled";

type MyOrderRow = {
    order: {
        id: number;
        status: MyOrderStatus;
        quantity: number;
        created_at: string;
        tracking_number: string | null;
        fulfillment_error: string | null;
        fulfillment_note: string | null;
        item_snapshot: {
            slug?: string | null;
            name: string;
            image_url: string | null;
            // Optional so pre-modifier orders still deserialize.
            selected_modifiers?: Array<{
                modifier_id: string;
                modifier_label: string;
                type: "single" | "multi" | "text";
                options: Array<{
                    option_id: string;
                    label: string;
                    price_delta_hours: number;
                }>;
                text_value?: string;
            }>;
        } | null;
    };
};

const {
    data: myOrders,
    pending: myOrdersLoading,
    error: myOrdersError,
    refresh: refreshMyOrders,
} = await useFetch<MyOrderRow[]>("/api/shop/my-orders", {
    key: "shop-my-orders",
    default: () => [] as MyOrderRow[],
    immediate: false,
    server: false,
    getCachedData: shopReuseCachedData<MyOrderRow[]>("shop-my-orders"),
});

type ShopView = "shop" | "order-detail" | "my-orders" | "currency" | "request";
const currentView = ref<ShopView>("shop");
const navDirection = ref<"forward" | "backward">("forward");
const transitionName = computed(() =>
    navDirection.value === "forward" ? "slide-left" : "slide-right",
);

async function goToOrders() {
    navDirection.value = "forward";
    currentView.value = "my-orders";
    await refreshMyOrders();
}

// MUST stay in sync with isOrderUserCancellable in server/policies/shop.ts.
function isOrderUserCancellable(status: MyOrderStatus): boolean {
    return status === "pending_internal_fulfillment" || status === "grant_pending";
}

const cancelTargetId = ref<number | null>(null);
const cancelling = ref(false);
const cancelError = ref<string>("");

function openCancelConfirm(orderId: number) {
    cancelTargetId.value = orderId;
    cancelError.value = "";
}

function closeCancelConfirm() {
    if (cancelling.value) return;
    cancelTargetId.value = null;
}

async function confirmCancelOrder() {
    if (cancelTargetId.value == null) return;
    cancelling.value = true;
    cancelError.value = "";
    try {
        await $fetch(`/api/shop/orders/${cancelTargetId.value}/cancel`, {
            method: "POST",
        });
        cancelTargetId.value = null;
        // The refund lands in gold or starfruit depending on the purchase currency.
        await Promise.all([
            refreshMyOrders(),
            refreshBalance(),
            refreshStarfruit(),
        ]);
    } catch (e: unknown) {
        const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
        cancelError.value = err?.data?.statusMessage ?? err?.statusMessage ?? "Could not cancel order.";
    } finally {
        cancelling.value = false;
    }
}

function goToCurrency() {
    navDirection.value = "forward";
    currentView.value = "currency";
}

function goToShopAddressLogin() {
    window.location.href = "/api/shop/address/login?return_to=/shop";
}

function backToShop() {
    navDirection.value = "backward";
    currentView.value = "shop";
    selectedItem.value = null;
    purchaseError.value = "";
    purchaseRestoreAttempts.value = 0;

    if (route.query.purchaseItem) {
        const nextQuery = { ...route.query };
        delete nextQuery.purchaseItem;
        void navigateTo({ path: route.path, query: nextQuery }, { replace: true });
    }
}

function statusMeta(status: MyOrderStatus, slug?: string | null): { key: string; tone: "amber" | "green" | "red" } {
    // Event Invite orders never leave pending_internal_fulfillment (staff fulfill them outside the
    // app), and an amber "Pending" badge generates support tickets.
    if (status === "pending_internal_fulfillment" && slug === "event_invite") {
        return { key: "shop_page.order_status.event_invite_approved", tone: "green" };
    }
    switch (status) {
        case "shipped":
        case "service_activated":
        case "grant_created":
            return { key: `shop_page.order_status.${status}`, tone: "green" };
        case "external_failure":
        case "cancelled":
            return { key: `shop_page.order_status.${status}`, tone: "red" };
        default:
            return { key: `shop_page.order_status.${status}`, tone: "amber" };
    }
}

const selectedItem = ref<ShopItem | null>(null);
const purchaseQuantity = ref(1);
// Matches the server-side limit in server/api/shop/orders.post.ts.
const SHOP_NOTE_MAX_LENGTH = 1000;
const fulfillmentNote = ref("");

// Mirrors the server's max_per_user enforcement in server/api/shop/orders.post.ts.
const effectivePurchaseMax = computed(() => {
    const item = selectedItem.value;
    if (!item) return 999;
    if (item.max_quantity_per_order != null) return item.max_quantity_per_order;
    if (item.max_per_user == null) return 999;
    return Math.min(999, Math.max(1, item.max_per_user - (item.user_purchased_count ?? 0)));
});

// Fixed-quantity items (e.g. Streak Freeze) hide the selector; the watcher below keeps it at 1.
const hasQuantitySelector = computed(() => {
    const item = selectedItem.value;
    if (!item) return false;
    return (item.max_quantity_per_order ?? 0) !== 1;
});

// Only clamp down: empty or partial values must survive so mobile users can clear and retype.
// Full normalization happens on blur.
watch([purchaseQuantity, effectivePurchaseMax], ([qty, max]) => {
    if (Number.isFinite(qty) && qty > max) {
        purchaseQuantity.value = max;
    }
});

function normalizePurchaseQuantity() {
    purchaseQuantity.value = clampPurchaseQuantity(
        purchaseQuantity.value,
        effectivePurchaseMax.value,
    );
}

// Otherwise a mobile keypad turns "1" into "12" when the user means to type "2".
function selectPurchaseQuantity(event: FocusEvent) {
    (event.target as HTMLInputElement).select();
}

const purchaseError = ref("");
const purchaseSuccess = ref("");
const purchasing = ref(false);
const addressAuthorizing = ref(false);
const purchaseRestoreAttempts = ref(0);
const selectedCheckoutAddressId = ref("");

const selectedModifiers = ref<Record<string, string | string[]>>({});

// Mirrors the server constant; modifier price deltas are stored in hours.
const SHOP_GOLD_PER_HOUR = 10;

const { t: i18nT } = useI18n();

function shopTimeLabel(priceGold: number): string {
    const d = shopHourDisplay(priceGold);
    return i18nT(`shop_page.${d.unit}_count`, { count: d.count });
}

function shopCardTime(item: ShopItem): { text: string; affordable: boolean } {
    const earn = shopTimeToEarn(item);
    if (earn) {
        return earn.affordable
            ? { text: i18nT("shop_page.affordable_now"), affordable: true }
            : {
                text: i18nT("shop_page.time_to_earn_short", { hours: earn.hours }),
                affordable: false,
            };
    }
    return { text: `~${shopTimeLabel(item.price_gold)}`, affordable: false };
}

function modifierOptionsArrayFor(modifierId: string): string[] {
    const value = selectedModifiers.value[modifierId];
    return Array.isArray(value) ? value : [];
}

function isMultiOptionSelected(modifierId: string, optionId: string): boolean {
    return modifierOptionsArrayFor(modifierId).includes(optionId);
}

function toggleMultiOption(modifierId: string, optionId: string) {
    const current = modifierOptionsArrayFor(modifierId);
    selectedModifiers.value = {
        ...selectedModifiers.value,
        [modifierId]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
    };
}

function setTextModifier(modifierId: string, event: Event) {
    selectedModifiers.value = {
        ...selectedModifiers.value,
        [modifierId]: (event.target as HTMLInputElement | null)?.value ?? "",
    };
}

function textModifierValue(modifierId: string): string {
    const value = selectedModifiers.value[modifierId];
    return typeof value === "string" ? value : "";
}

function selectSingleOption(modifierId: string, optionId: string, required: boolean) {
    const current = selectedModifiers.value[modifierId];
    // Optional singles toggle off on re-click; required ones can only swap.
    if (!required && current === optionId) {
        const { [modifierId]: _ignored, ...rest } = selectedModifiers.value;
        selectedModifiers.value = rest;
        return;
    }
    selectedModifiers.value = {
        ...selectedModifiers.value,
        [modifierId]: optionId,
    };
}

const purchaseRequiresCheckoutAddress = computed(
    () => selectedItem.value?.kind === "physical" || selectedItem.value?.kind === "grant",
);
const purchaseUsesBillingAddress = computed(() => selectedItem.value?.kind === "grant");
const purchaseAddressLabelKey = computed(() =>
    purchaseUsesBillingAddress.value
        ? "shop_page.billing_address"
        : "shop_page.shipping_address",
);
const checkoutAddress = computed(() => checkoutAddressData.value ?? null);
const checkoutAddresses = computed(() => {
    if (checkoutAddress.value?.addresses?.length) return checkoutAddress.value.addresses;
    if (!checkoutAddress.value?.shippingAddress) return [];

    return [{
        id: "primary",
        label: formatAddressLabel(checkoutAddress.value.shippingAddress),
        primary: true,
        shippingAddress: checkoutAddress.value.shippingAddress,
        phone: checkoutAddress.value.phone,
    }];
});
const selectedCheckoutAddress = computed(
    () =>
        checkoutAddresses.value.find((entry) => entry.id === selectedCheckoutAddressId.value) ??
        checkoutAddresses.value.find((entry) => entry.primary) ??
        checkoutAddresses.value[0] ??
        null,
);
const requestedPurchaseItemId = computed(() => {
    const purchaseItemId = Number(route.query.purchaseItem);
    return Number.isInteger(purchaseItemId) && purchaseItemId > 0
        ? purchaseItemId
        : null;
});
const isRestoringPurchase = computed(
    () => requestedPurchaseItemId.value != null && !selectedItem.value,
);
// Fruit-priced items never carry modifiers (rejected admin-side), so this is gold only.
const selectedModifierDeltaGold = computed(() => {
    const item = selectedItem.value;
    if (!item?.modifiers?.length) return 0;
    let deltaHours = 0;
    for (const modifier of item.modifiers) {
        const selection = selectedModifiers.value[modifier.id];
        if (selection == null) continue;
        if (modifier.type === "text") {
            if (typeof selection === "string" && selection.trim()) {
                deltaHours += modifier.price_delta_hours ?? 0;
            }
            continue;
        }
        for (const optionId of Array.isArray(selection) ? selection : [selection]) {
            const option = modifier.options.find((opt) => opt.id === optionId);
            if (option) deltaHours += option.price_delta_hours;
        }
    }
    return deltaHours * SHOP_GOLD_PER_HOUR;
});

// orders.post.ts prices physical items by the selected address's country, not the browse
// region, so re-quote once an address is chosen to show what the server will charge.
type RegionQuote = {
    item_id: number;
    ship_country: string | null;
    order_region: ShopRegion | null;
    browse_region: ShopRegion;
    price_gold: number;
    regular_price_gold: number;
    is_on_sale: boolean;
    available_in_region: boolean;
    browse_price_gold: number;
    region_price_differs: boolean;
};
const regionQuote = ref<RegionQuote | null>(null);
const regionQuoteLoading = ref(false);

// A stale quote from a previously-opened item falls back to the browse price.
const activeRegionQuote = computed(() => {
    const item = selectedItem.value;
    if (!item || item.kind !== "physical") return null;
    const q = regionQuote.value;
    return q && q.item_id === item.id ? q : null;
});

async function fetchRegionQuote() {
    const item = selectedItem.value;
    if (!item || item.kind !== "physical") {
        regionQuote.value = null;
        return;
    }
    const address = selectedCheckoutAddress.value;
    if (!address) {
        regionQuote.value = null;
        return;
    }
    regionQuoteLoading.value = true;
    try {
        const quote = await $fetch<RegionQuote>("/api/shop/quote", {
            method: "POST",
            body: { itemId: item.id, addressId: address.id },
        });
        // Guard against a race: only apply if it's still the open item.
        if (selectedItem.value?.id === quote.item_id) {
            regionQuote.value = quote;
        }
    } catch (e) {
        // Non-fatal: the server still charges the shipping-region price and rejects if unaffordable.
        console.error("Failed to fetch shipping-region price quote", e);
        regionQuote.value = null;
    } finally {
        regionQuoteLoading.value = false;
    }
}

watch(
    () => [currentView.value, selectedItem.value?.id, selectedCheckoutAddress.value?.id],
    () => {
        if (currentView.value !== "order-detail") return;
        void fetchRegionQuote();
    },
    { immediate: true },
);

const unitBaseGold = computed(
    () => activeRegionQuote.value?.price_gold ?? selectedItem.value?.price_gold ?? 0,
);

const summaryRegularGold = computed(
    () => activeRegionQuote.value?.regular_price_gold ?? selectedItem.value?.regular_price_gold ?? 0,
);
const summaryOnSale = computed(
    () => activeRegionQuote.value?.is_on_sale ?? selectedItem.value?.is_on_sale ?? false,
);

// The server enforces this too; checking here disables the buy button with a clear reason.
const shippingRegionUnavailable = computed(
    () => activeRegionQuote.value?.available_in_region === false,
);

// Clamped so a misconfigured modifier can't show a negative price (the server clamps too).
const effectiveUnitGold = computed(() =>
    Math.max(0, unitBaseGold.value + selectedModifierDeltaGold.value),
);

const selectedTotalGold = computed(
    () => effectiveUnitGold.value * purchaseQuantity.value,
);

const allRequiredModifiersPicked = computed(() => {
    for (const modifier of selectedItem.value?.modifiers ?? []) {
        if (modifier.type === "single" && modifier.required) {
            const value = selectedModifiers.value[modifier.id];
            if (typeof value !== "string" || !value) return false;
        }
        if (modifier.type === "text" && modifier.required) {
            const value = selectedModifiers.value[modifier.id];
            if (typeof value !== "string" || !value.trim()) return false;
        }
    }
    return true;
});

function buildSelectedModifiersPayload(): Array<
    | { modifier_id: string; option_id: string }
    | { modifier_id: string; option_ids: string[] }
    | { modifier_id: string; text: string }
> {
    const item = selectedItem.value;
    if (!item?.modifiers?.length) return [];
    const out: Array<
        | { modifier_id: string; option_id: string }
        | { modifier_id: string; option_ids: string[] }
        | { modifier_id: string; text: string }
    > = [];
    for (const modifier of item.modifiers) {
        const value = selectedModifiers.value[modifier.id];
        if (modifier.type === "text") {
            if (typeof value === "string" && value.trim()) {
                out.push({ modifier_id: modifier.id, text: value.trim() });
            }
        } else if (modifier.type === "single") {
            if (typeof value === "string" && value) {
                out.push({ modifier_id: modifier.id, option_id: value });
            }
        } else {
            const ids = Array.isArray(value) ? value : [];
            if (ids.length > 0) {
                out.push({ modifier_id: modifier.id, option_ids: ids });
            }
        }
    }
    return out;
}
const selectionSpendableGold = computed(() => {
    const slug = selectedItem.value?.slug;
    return slug && PENDING_GOLD_SLUGS.has(slug) ? eventSpendableGold.value : gold.value;
});
const canAffordSelection = computed(() => {
    const item = selectedItem.value;
    if (!item) return false;
    return selectionSpendableGold.value >= selectedTotalGold.value;
});
const canSubmitPurchase = computed(
    () =>
        canAffordSelection.value &&
        allRequiredModifiersPicked.value &&
        !selectedItem.value?.blocked_no_shipped_project &&
        !shippingRegionUnavailable.value &&
        // Don't let a physical item be bought against a stale browse price
        // while its shipping-region quote is still loading.
        !(selectedItem.value?.kind === "physical" && regionQuoteLoading.value) &&
        (!purchaseRequiresCheckoutAddress.value || !!selectedCheckoutAddress.value),
);

function grantAmountLabel(item: ShopItem) {
    return item.grant_amount_cents != null
        ? `$${(item.grant_amount_cents / 100).toFixed(2)}`
        : null;
}

function shopItemKindLabelKey(kind: ShopItem["kind"]) {
    if (kind === "grant") return "shop_page.kind_grant";
    if (kind === "consumable") return "shop_page.kind_consumable";
    if (kind === "experience") return "shop_page.kind_experience";
    if (kind === "virtual_service") return "shop_page.kind_virtual_service";
    return "shop_page.kind_physical";
}

function itemButtonLabel(item: ShopItem) {
    const { t } = useNuxtApp().$i18n as { t: (key: string, params?: Record<string, unknown>) => string };
    if (item.coming_soon) return t("shop_page.coming_soon");
    if (item.hit_per_user_cap) return t("shop_page.per_user_cap_reached");
    const totalGold = item.price_gold * (
        purchaseQuantity.value > 1 && selectedItem.value?.id === item.id
            ? purchaseQuantity.value
            : 1
    );
    if (totalGold === 0) return t("shop_page.get_for_free");
    return t("shop_page.buy_for_gold", { gold: formatGoldCompact(totalGold) });
}

// The server enforces the starfruit balance and gating, so the client stays simple.
const unlockingItemId = ref<number | null>(null);
const unlockError = ref<string | null>(null);

// Spending a starfruit is irreversible, so a stray click on the CTA must not commit it directly.
const unlockConfirmItem = ref<ShopItem | null>(null);
function openUnlockConfirm(item: ShopItem) {
    if (typeof item.id !== "number") return;
    if (item.user_has_unlocked === true) return;
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (starfruit.value < 1) {
        unlockError.value = (useNuxtApp().$i18n as { t: (k: string) => string }).t(
            "shop_page.locked_need_starfruit",
        );
        return;
    }
    unlockError.value = null;
    unlockConfirmItem.value = item;
}
function closeUnlockConfirm() {
    unlockConfirmItem.value = null;
}
function confirmUnlock() {
    const item = unlockConfirmItem.value;
    unlockConfirmItem.value = null;
    if (item) void unlockExtraFruityItem(item);
}

async function unlockExtraFruityItem(item: ShopItem) {
    if (typeof item.id !== "number") return;
    if (item.user_has_unlocked === true) return;
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (starfruit.value < 1) {
        unlockError.value = (useNuxtApp().$i18n as { t: (k: string) => string }).t(
            "shop_page.locked_need_starfruit",
        );
        return;
    }
    unlockingItemId.value = item.id;
    unlockError.value = null;
    try {
        await $fetch(`/api/shop/items/${item.id}/unlock`, { method: "POST" });
        await Promise.all([refreshStarfruit(), refreshShopItems(), refreshBalance()]);
    } catch (error) {
        unlockError.value =
            (error as { statusMessage?: string; message?: string }).statusMessage
            ?? (error as { message?: string }).message
            ?? "Failed to unlock item";
    } finally {
        unlockingItemId.value = null;
    }
}

function formatAddressLabel(address: ShippingAddress) {
    return [
        `${address.firstName} ${address.lastName}`.trim(),
        address.address1,
        address.address2,
        address.city,
        address.state,
        address.postalCode,
        address.country,
    ].filter(Boolean).join(" - ");
}

function shortAddressLabel(address: CheckoutAddressOption) {
    return [
        `${address.shippingAddress.firstName} ${address.shippingAddress.lastName}`.trim(),
        address.shippingAddress.address1,
        address.shippingAddress.address2,
    ].filter(Boolean).join(" - ");
}

function addressLocationLabel(address: CheckoutAddressOption) {
    return [
        address.shippingAddress.city,
        address.shippingAddress.state,
        address.shippingAddress.postalCode,
        address.shippingAddress.country,
    ].filter(Boolean).join(", ");
}

function openPurchaseModal(item: ShopItem) {
    if (item.coming_soon) return;
    if (item.available_in_region === false) return;
    if (item.hit_per_user_cap) return;
    if (!isLoggedIn.value) {
        window.location.href = "/api/auth/login?return_to=/";
        return;
    }
    selectedItem.value = item;
    purchaseQuantity.value = 1;
    fulfillmentNote.value = "";
    purchaseError.value = "";
    purchaseSuccess.value = "";
    navDirection.value = "forward";
    currentView.value = "order-detail";

    const initial: Record<string, string | string[]> = {};
    for (const modifier of item.modifiers ?? []) {
        if (modifier.type === "multi") {
            initial[modifier.id] = [];
        } else if (modifier.type === "text") {
            initial[modifier.id] = "";
        } else if (modifier.required && modifier.options.length > 0) {
            initial[modifier.id] = modifier.options[0]!.id;
        }
    }
    selectedModifiers.value = initial;

    if (item.kind === "physical" || item.kind === "grant") {
        void refreshCheckoutAddress();
    }
}

function closePurchaseModal() {
    backToShop();
}

async function submitPurchase() {
    if (!selectedItem.value) return;
    if (purchaseRequiresCheckoutAddress.value && !selectedCheckoutAddress.value) {
        const { t } = useNuxtApp().$i18n as { t: (key: string) => string };
        purchaseError.value = t(
            purchaseUsesBillingAddress.value
                ? "shop_page.confirm_billing_first"
                : "shop_page.confirm_shipping_first",
        );
        return;
    }

    purchaseError.value = "";
    purchaseSuccess.value = "";
    purchasing.value = true;

    try {
        const modifiersPayload = buildSelectedModifiersPayload();
        const response = await $fetch<{ message?: string }>("/api/shop/orders", {
            method: "POST",
            body: {
                itemId: selectedItem.value.id,
                quantity: purchaseQuantity.value,
                addressId: purchaseRequiresCheckoutAddress.value
                    ? selectedCheckoutAddress.value?.id
                    : undefined,
                selectedModifiers: modifiersPayload.length > 0 ? modifiersPayload : undefined,
                note: fulfillmentNote.value.trim() || undefined,
            },
        });

        const { t: tt } = useNuxtApp().$i18n as { t: (key: string, params?: Record<string, unknown>) => string };
        purchaseSuccess.value = response.message ?? tt("shop_page.purchased_success", { name: selectedItem.value.name });
        closePurchaseModal();
        await Promise.all([
            refreshBalance(),
            refreshShopItems(),
            refreshCheckoutAddress(),
            // refresh the session so the navbar/profile see the new freeze count
            useAuth().fetchSession(),
        ]);
    } catch (error) {
        console.error(error);
        purchaseError.value =
            typeof error === "object" &&
            error &&
            "data" in error &&
            typeof error.data === "object" &&
            error.data &&
            "statusMessage" in error.data &&
            typeof error.data.statusMessage === "string"
                ? error.data.statusMessage
                : (useNuxtApp().$i18n as { t: (key: string) => string }).t("shop_page.purchase_failed");
    } finally {
        purchasing.value = false;
    }
}

async function retryShopItemsForPurchaseRestore() {
    if (!isRestoringPurchase.value) return;
    if (loadingShopItems.value) return;
    if (purchaseRestoreAttempts.value >= 3) return; // give up after three retries

    purchaseRestoreAttempts.value += 1;
    await refreshShopItems();
    restorePurchaseModalFromQuery();
}

function buildAddressReturnTo() {
    if (!import.meta.client) return "/shop";

    if (props.embeddedWindowed || route.path === "/dashboard") {
        const params = new URLSearchParams();
        params.set("shop", "1");
        if (selectedItem.value) {
            params.set("purchaseItem", String(selectedItem.value.id));
        }
        return `/dashboard?${params.toString()}`;
    }

    const currentUrl = new URL(window.location.href);
    if (selectedItem.value) {
        currentUrl.searchParams.set("purchaseItem", String(selectedItem.value.id));
    }

    return `${currentUrl.pathname}${currentUrl.search}`;
}

function requestCheckoutAddress() {
    if (!import.meta.client) return;

    addressAuthorizing.value = true;
    window.location.href =
        `/api/shop/address/login?return_to=${encodeURIComponent(buildAddressReturnTo())}`;
}

function restorePurchaseModalFromQuery() {
    const purchaseItemId = requestedPurchaseItemId.value;
    if (!purchaseItemId) return;
    if (loadingShopItems.value) return;

    const item = (shopItems.value ?? []).find((entry) => entry.id === purchaseItemId);
    if (!item) {
        void retryShopItemsForPurchaseRestore();
        return;
    }

    if (selectedItem.value?.id === item.id) return;

    purchaseRestoreAttempts.value = 0;
    openPurchaseModal(item);
}

onMounted(() => {
    restorePurchaseModalFromQuery();
    // Deep links like /shop?view=currency from the navbar streak counter.
    const initialView = route.query.view;
    if (initialView === "currency" || initialView === "my-orders" || initialView === "request") {
        currentView.value = initialView;
    }
});

watch(
    () => route.query.purchaseItem,
    () => {
        restorePurchaseModalFromQuery();
    },
);

watch(
    () => [loadingShopItems.value, shopItems.value?.length ?? 0],
    () => {
        restorePurchaseModalFromQuery();
    },
);

watch(
    checkoutAddresses,
    (addresses) => {
        if (addresses.length === 0) {
            selectedCheckoutAddressId.value = "";
            return;
        }

        if (addresses.some((entry) => entry.id === selectedCheckoutAddressId.value)) return;

        selectedCheckoutAddressId.value =
            addresses.find((entry) => entry.primary)?.id ?? addresses[0]?.id ?? "";
    },
    { immediate: true },
);

// Embedded in the dashboard modal, WoodFrame's inner wrapper scrolls instead of the document.
const shopRootEl = ref<HTMLElement | null>(null);

watch(currentView, async () => {
    if (!import.meta.client) return;
    await nextTick();
    const root = shopRootEl.value;
    if (!root) return;

    let el: HTMLElement | null = root.parentElement;
    while (el) {
        const style = window.getComputedStyle(el);
        if (
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            el.scrollHeight > el.clientHeight
        ) {
            el.scrollTop = 0;
            return;
        }
        el = el.parentElement;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
});
</script>

<template>
    <div ref="shopRootEl" :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'">
        <div class="max-w-4xl mx-auto px-4 pb-12 pt-6 relative overflow-x-hidden">
            <Transition :name="transitionName" mode="out-in">
                <div v-if="currentView === 'shop'" key="shop" class="flex flex-col gap-6">
                    <div v-if="isWindowed && isLoggedIn" class="flex items-center justify-between gap-4 w-full flex-wrap">
                        <button
                            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
                            @click="closeModal"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            {{ $t("shop_page.back_to_farm") }}
                        </button>
                        <a
                            href="/shop"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
                        >
                            {{ $t("shop_page.open_in_new_tab") }}
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>
                    <NuxtLink
                        v-else-if="isLoggedIn"
                        to="/dashboard"
                        class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                        {{ $t("shop_page.back_to_farm") }}
                    </NuxtLink>

                    <p v-if="purchaseSuccess" class="text-sm text-ds-brown bg-white/50 border-[2px] border-ds-brown/20 px-4 py-3">
                        {{ purchaseSuccess }}
                    </p>

            <div
                v-if="pendingAddressData && pendingAddressData.count > 0"
                class="flex gap-3 p-4 border-l-[5px]"
                :style="{ background: 'rgb(137 40 8 / 0.10)', borderLeftColor: '#892808' }"
            >
                <AlertTriangle :size="20" color="#892808" class="shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div class="flex-1 text-sm">
                        <div class="font-bold text-sm uppercase tracking-wide mb-1" style="color: #892808;">
                            {{ $t("shop_page.reward_orders_waiting", { count: pendingAddressData.count }) }}
                        </div>
                        <p class="text-ds-brown/90">
                            <template v-if="pendingAddressData.needs_hca_link">
                                {{ $t("shop_page.link_hca_for_sticker") }}
                            </template>
                            <template v-else>
                                {{ $t("shop_page.update_hca_address") }}
                            </template>
                        </p>
                        <p v-if="pendingAddressMessage" class="text-xs text-ds-brown/70 mt-1">
                            {{ pendingAddressMessage }}
                        </p>
                    </div>
                    <div class="flex flex-row gap-2 shrink-0">
                        <button
                            type="button"
                            class="px-4 py-2 bg-[#8b4513] text-white text-sm font-semibold hover:bg-[#6b3410] transition"
                            @click="goToShopAddressLogin"
                        >
                            {{ pendingAddressData.needs_hca_link ? $t("shop_page.link_hackclub") : $t("shop_page.update_address") }}
                        </button>
                        <button
                            type="button"
                            :disabled="pendingAddressSyncing"
                            class="px-4 py-2 bg-white/70 text-[#3b1d08] border border-[#8b4513]/40 text-sm font-semibold hover:bg-white transition disabled:opacity-50"
                            @click="syncPendingAddress"
                        >
                            {{ pendingAddressSyncing ? $t("shop_page.syncing") : $t("shop_page.sync") }}
                        </button>
                    </div>
                </div>
            </div>

            <component :is="'div'" v-if="isLoggedIn">
                <div :class="isWindowed && 'pb-6'">
                    <div class="flex items-center justify-between mb-6 gap-3 flex-wrap">
                        <h2 class="text-lg font-bold text-ds-brown">{{ $t("shop_page.exchange") }}</h2>
                        <div class="flex items-center gap-2 flex-wrap">
                            <button
                                type="button"
                                class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-ds-brown/10 text-ds-brown border-[2px] border-ds-brown hover:bg-ds-brown/20 active:scale-95 transition-all"
                                @click="goToCurrency"
                            >
                                {{ $t("shop_page.currency_guide") }}
                            </button>
                            <button
                                type="button"
                                class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-ds-brown text-ds-cream border-[2px] border-ds-brown hover:bg-ds-brown/90 active:scale-95 transition-all"
                                @click="goToOrders"
                            >
                                {{ $t("shop_page.my_orders") }}
                            </button>
                        </div>
                    </div>

                    <div class="border-[3px] border-ds-brown/20 bg-ds-brown/5 mb-6">
                        <div class="flex items-stretch gap-3 p-4">
                            <div class="flex items-center gap-3 flex-1">
                                <img :src="'/images/icons/money.webp'" class="w-10 h-10 object-contain" :alt="$t('exchange.gold_alt')">
                                <div>
                                    <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">{{ $t("shop_page.your_gold") }}</span>
                                    <span class="text-2xl font-bold text-ds-brown">{{ formatGold(gold) }}</span>
                                </div>
                            </div>
                            <div class="w-px bg-ds-brown/20" />
                            <div class="flex items-center gap-3 flex-1">
                                <img src="/images/fruits/starfruit.webp" class="w-10 h-10 object-contain" :alt="$t('exchange.starfruit_alt')">
                                <div>
                                    <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">{{ $t("shop_page.your_starfruit") }}</span>
                                    <span class="text-2xl font-bold text-ds-brown">{{ starfruit }}</span>
                                </div>
                            </div>
                            <button
                                type="button"
                                :aria-label="$t('shop_page.currency_help_aria')"
                                class="ml-auto text-ds-brown/60 hover:text-ds-brown transition-colors focus:outline-none focus:ring-2 focus:ring-ds-brown/40"
                                @click="goToCurrency"
                            >
                                <HelpCircle class="w-5 h-5" />
                            </button>
                        </div>
                        <div
                            v-if="earningRate?.gold_per_hour != null"
                            class="flex items-center gap-2 px-4 py-2.5 border-t-[2px] border-ds-brown/15 text-ds-brown/70"
                        >
                            <TrendingUp class="w-4 h-4 shrink-0" />
                            <span class="text-xs sm:text-sm">{{ $t("shop_page.earning_rate", { n: earningRate.gold_per_hour }) }}</span>
                        </div>
                    </div>

                </div>
            </component>

            <component
                :is="'div'"
                v-if="eventBarItem && eventBarItem.available !== false && !eventBarItem.coming_soon && !shopUnderRenovation"
            >
                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-1.5 min-w-0">
                        <div class="flex items-center gap-2 text-ds-brown">
                            <PartyPopper class="w-6 h-6 shrink-0" />
                            <h2 class="font-bold text-xl sm:text-2xl leading-tight">
                                {{ $t("shop_page.event_bar.title") }}
                            </h2>
                        </div>
                        <p class="text-sm text-ds-brown/80 font-medium flex items-center gap-1.5">
                            <MapPin class="w-4 h-4 shrink-0" />
                            {{ $t("shop_page.event_bar.pitch") }}
                        </p>
                        <p class="text-sm text-ds-brown/80 font-medium flex items-center gap-1.5">
                            <Award class="w-4 h-4 shrink-0" />
                            {{ $t("shop_page.event_bar.includes_certificate") }}
                        </p>
                        <p
                            v-if="eventHoursProgress"
                            class="text-xs sm:text-sm flex items-center gap-1.5"
                            :class="eventStatus?.autoQualified || eventCanAfford ? 'text-ds-success font-bold' : 'text-ds-brown/70'"
                        >
                            <Clock class="w-3.5 h-3.5 shrink-0" />
                            <span v-if="eventStatus?.autoQualified">{{ $t("shop_page.event_bar.qualified") }}</span>
                            <span v-else-if="eventCanAfford">{{ $t("shop_page.event_bar.affordable_now", { threshold: eventHoursProgress.total }) }}</span>
                            <span v-else>{{ $t("shop_page.event_bar.qualify_progress", { hours: eventHoursProgress.earned, threshold: eventHoursProgress.total, gold: eventBarItem ? formatGold(eventBarItem.price_gold) : "" }) }}</span>
                        </p>
                        <p
                            v-else-if="eventBarHours"
                            class="text-xs sm:text-sm flex items-center gap-1.5"
                            :class="eventBarHours.affordable ? 'text-ds-success font-bold' : 'text-ds-brown/70'"
                        >
                            <Clock class="w-3.5 h-3.5 shrink-0" />
                            <span v-if="eventBarHours.affordable">{{ $t("shop_page.event_bar.hours_affordable") }}</span>
                            <span v-else-if="eventBarHours.personalized">{{ $t("shop_page.event_bar.hours_personalized", { hours: eventBarHours.hours }) }}</span>
                            <span v-else>{{ $t("shop_page.event_bar.hours_generic", { hours: eventBarHours.hours }) }}</span>
                        </p>
                        <div v-if="eventHoursProgress || eventGoldProgress" class="flex flex-col gap-2">
                            <div v-if="eventHoursProgress" class="flex flex-col gap-1">
                                <div class="flex items-center justify-between text-xs font-bold text-ds-brown">
                                    <span>{{ $t("shop_page.event_bar.hours_label", { earned: eventHoursProgress.earned, total: eventHoursProgress.total }) }}</span>
                                    <span class="text-ds-brown/55 font-medium">{{ eventHoursProgress.pct }}%</span>
                                </div>
                                <div class="w-full h-2.5 bg-ds-brown/15 border border-ds-brown overflow-hidden">
                                    <div
                                        class="h-full bg-ds-brown transition-all duration-500"
                                        :style="{ width: eventHoursProgress.pct + '%' }"
                                    />
                                </div>
                            </div>
                            <div
                                v-if="eventHoursProgress && eventGoldProgress"
                                class="text-center text-[11px] font-bold uppercase tracking-wide text-ds-brown/60"
                            >
                                {{ $t("shop_page.event_bar.or_divider") }}
                            </div>
                            <div v-if="eventGoldProgress" class="flex flex-col gap-1">
                                <div class="flex items-center justify-between text-xs font-bold text-ds-brown">
                                    <span>{{ $t("shop_page.event_bar.gold_label", { earned: formatGold(eventGoldProgress.earned), total: formatGold(eventGoldProgress.total) }) }}</span>
                                    <span class="text-ds-brown/55 font-medium">{{ eventGoldProgress.pct }}%</span>
                                </div>
                                <div class="w-full h-2.5 bg-ds-brown/15 border border-ds-brown overflow-hidden">
                                    <div
                                        class="h-full bg-ds-gold transition-all duration-500"
                                        :style="{ width: eventGoldProgress.pct + '%' }"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <NuxtLink
                            to="/event"
                            class="ds-btn-primary-inverted px-4 py-2.5 text-sm whitespace-nowrap"
                        >
                            {{ $t("shop_page.event_bar.learn_more") }}
                        </NuxtLink>
                        <span
                            v-if="eventStatus?.alreadyPurchased"
                            class="text-sm font-bold text-ds-success flex items-center gap-1.5"
                        >
                            <PartyPopper class="w-4 h-4 shrink-0" />
                            {{ $t("shop_page.event_bar.have_ticket") }}
                        </span>
                        <!-- Always show the gold price so the paid route isn't hidden behind the free-seat pitch. -->
                        <button
                            v-else
                            type="button"
                            class="px-4 py-2.5 text-sm whitespace-nowrap active:scale-95 transition-transform"
                            :class="eventCanAfford ? 'ds-btn-success' : 'ds-btn-primary'"
                            @click="eventBarItem && openPurchaseModal(eventBarItem)"
                        >
                            {{ eventBarItem ? $t("shop_page.event_bar.buy_priced", { gold: formatGold(eventBarItem.price_gold) }) : $t("shop_page.event_bar.buy") }}
                        </button>
                        <!-- Claiming stays the maker's call so they confirm the name on the certificate. -->
                        <NuxtLink
                            v-if="eventStatus?.alreadyPurchased && !eventStatus?.hasCertificate"
                            to="/certificate"
                            class="ds-btn-primary-inverted px-4 py-2.5 text-sm whitespace-nowrap"
                        >
                            {{ $t("shop_page.event_bar.claim_certificate") }}
                        </NuxtLink>
                    </div>
                </div>
            </component>

            <component :is="'div'" v-if="isLoggedIn && starredShopItems.length > 0">
                <ShopWishlistPanel
                    :items="starredShopItems"
                    :gold="gold"
                    :gold-per-hour="earningRate?.gold_per_hour ?? null"
                    @unstar="unstarFromWishlist"
                />
            </component>

            <component :is="'div'">
                <div :class="isWindowed ? '' : ''">
                    <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
                        <h2 class="text-lg font-bold text-ds-brown">
                            {{ $t("shop_page.items") }}
                        </h2>
                        <div class="flex items-center gap-4 flex-wrap">
                            <label class="flex items-center gap-2 text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                                <span>{{ $t("shop_page.region_label") }}</span>
                                <select
                                    :value="resolvedRegion"
                                    :disabled="regionOverrideSaving"
                                    class="ds-input !py-1 !px-2 text-xs normal-case tracking-normal"
                                    @change="(e) => changeRegion(((e.target as HTMLSelectElement).value) as ShopRegion)"
                                >
                                    <option value="NA">{{ REGION_LABELS.NA }}</option>
                                    <option value="SA">{{ REGION_LABELS.SA }}</option>
                                    <option value="BR">{{ REGION_LABELS.BR }}</option>
                                    <option value="EU">{{ REGION_LABELS.EU }}</option>
                                    <option value="AS">{{ REGION_LABELS.AS }}</option>
                                    <option value="IN">{{ REGION_LABELS.IN }}</option>
                                    <option value="OC">{{ REGION_LABELS.OC }}</option>
                                    <option value="AF">{{ REGION_LABELS.AF }}</option>
                                    <option value="ME">{{ REGION_LABELS.ME }}</option>
                                </select>
                            </label>
                            <label class="flex items-center gap-2 text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                                <span>{{ $t("shop_page.sort_by") }}</span>
                                <select
                                    v-model="sortKey"
                                    class="ds-input !py-1 !px-2 text-xs normal-case tracking-normal"
                                >
                                    <option value="featured">{{ $t("shop_page.sort_featured") }}</option>
                                    <option value="price_asc">{{ $t("shop_page.sort_price_asc") }}</option>
                                    <option value="price_desc">{{ $t("shop_page.sort_price_desc") }}</option>
                                    <option value="name_asc">{{ $t("shop_page.sort_name_asc") }}</option>
                                    <option value="name_desc">{{ $t("shop_page.sort_name_desc") }}</option>
                                </select>
                            </label>
                            <div v-if="isLoggedIn" class="flex items-center gap-2">
                                <button
                                    type="button"
                                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border-[2px] active:scale-95 transition-all"
                                    :class="filterAffordable ? 'bg-ds-brown text-ds-cream border-ds-brown' : 'bg-ds-brown/10 text-ds-brown/70 border-ds-brown/30 hover:bg-ds-brown/20'"
                                    :aria-pressed="filterAffordable"
                                    @click="filterAffordable = !filterAffordable"
                                >
                                    {{ $t("shop_page.filter_affordable") }}
                                </button>
                                <button
                                    type="button"
                                    class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border-[2px] active:scale-95 transition-all"
                                    :class="filterUnlocked ? 'bg-ds-brown text-ds-cream border-ds-brown' : 'bg-ds-brown/10 text-ds-brown/70 border-ds-brown/30 hover:bg-ds-brown/20'"
                                    :aria-pressed="filterUnlocked"
                                    @click="filterUnlocked = !filterUnlocked"
                                >
                                    {{ $t("shop_page.filter_unlocked") }}
                                </button>
                            </div>
                        </div>
                    </div>
                    <p class="text-xs text-ds-brown/60 mb-3">
                        {{ $t("shop_page.prices_for_region", { region: REGION_LABELS[resolvedRegion] }) }}
                    </p>

                    <div
                        v-if="availableCategories.length > 0"
                        class="flex flex-wrap items-center gap-2 mb-4"
                    >
                        <button
                            type="button"
                            class="px-3 py-1 text-xs font-bold border-[2px] active:scale-95 transition-all"
                            :class="categoryFilter === null ? 'bg-ds-brown text-ds-cream border-ds-brown' : 'bg-ds-brown/10 text-ds-brown/70 border-ds-brown/30 hover:bg-ds-brown/20'"
                            @click="categoryFilter = null"
                        >
                            {{ $t("shop_page.category.all") }}
                        </button>
                        <button
                            v-for="cat in availableCategories"
                            :key="cat"
                            type="button"
                            class="px-3 py-1 text-xs font-bold border-[2px] active:scale-95 transition-all"
                            :class="categoryFilter === cat ? 'bg-ds-brown text-ds-cream border-ds-brown' : 'bg-ds-brown/10 text-ds-brown/70 border-ds-brown/30 hover:bg-ds-brown/20'"
                            @click="categoryFilter = cat"
                        >
                            {{ $t(`shop_page.category.${cat}`) }}
                        </button>
                    </div>

                    <div
                        v-if="isRestoringPurchase || (loadingShopItems && shopItems.length === 0)"
                        class="border-[2px] border-ds-brown/20 bg-white/50 p-6 text-sm text-ds-brown/60"
                    >
                        {{ isRestoringPurchase ? $t("shop_page.opening_item") : $t("shop_page.loading_items") }}
                    </div>

                    <div
                        v-else-if="shopUnderRenovation"
                        class="border-[3px] border-ds-brown/40 bg-[#f6e5c8]/80 p-8 text-center flex flex-col items-center gap-3 shadow-sm"
                    >
                        <AlertTriangle class="w-10 h-10 text-ds-brown/60" />
                        <p class="font-bold text-ds-brown text-lg">
                            {{ $t("shop_page.under_renovation_title") }}
                        </p>
                        <p class="text-sm text-ds-brown/70 max-w-md">
                            {{ $t("shop_page.under_renovation_body") }}
                        </p>
                    </div>

                    <div
                        v-else-if="shopItems.length === 0"
                        class="border-[2px] border-ds-brown/20 bg-white/50 p-6 text-sm text-ds-brown/60"
                    >
                        {{ $t("shop_page.no_items") }}
                    </div>

                    <!-- Keep the previous items (dimmed) during a region refresh instead of flashing to loading. -->
                    <div
                        v-else
                        ref="shopGridRef"
                        class="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 grid-flow-row-dense [grid-auto-rows:1fr] transition-opacity duration-150"
                        :class="{ 'opacity-60 pointer-events-none': loadingShopItems || regionOverrideSaving }"
                    >
                        <div
                            v-for="item in sortedShopItems"
                            :key="item.id"
                            :data-flip-id="item.id"
                            class="group relative border-[3px] border-ds-brown/20 bg-[#f6e5c8]/80 p-3 flex flex-col gap-4 hover:border-ds-brown/40 hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow,border-color] duration-300 shadow-sm"
                            :class="{ 'opacity-60 grayscale': item.available_in_region === false }"
                        >
                            <div
                                v-if="item.available_in_region === false"
                                class="absolute right-3 top-3 z-10 rounded-sm bg-ds-brown/80 text-ds-cream px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                            >
                                {{ $t("shop_page.not_available_in_region") }}
                            </div>
                            <button
                                v-if="isLoggedIn"
                                type="button"
                                class="absolute right-3 z-20 p-1.5 bg-[#f2d8b7]/90 border border-ds-brown/20 hover:border-ds-brown/50 transition-colors group/star"
                                :class="item.available_in_region === false ? 'top-12' : 'top-3'"
                                :aria-label="isItemStarred(item)
                                    ? $t('shop_page.unstar_aria', { name: item.name })
                                    : $t('shop_page.star_aria', { name: item.name })"
                                :title="isItemStarred(item) ? $t('shop_page.unstar') : $t('shop_page.star')"
                                @click.stop="toggleStar(item, $event)"
                            >
                                <Star
                                    class="w-4 h-4 transition-colors"
                                    :class="isItemStarred(item)
                                        ? 'fill-ds-brown text-ds-brown'
                                        : 'text-ds-brown/50 group-hover/star:text-ds-brown'"
                                />
                            </button>
                            <div
                                v-if="item.inventory_mode === 'limited'"
                                class="absolute left-3 top-3 z-10 rounded-sm bg-[#f2d8b7]/90 border border-ds-brown/10 px-2 py-1 text-xs font-bold text-ds-brown"
                            >
                                {{ $t("shop_page.stock_left", { count: item.stock_remaining ?? 0 }) }}
                            </div>
                            <div
                                v-if="item.max_per_user != null"
                                class="absolute left-3 z-10 rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                                :class="[
                                    item.inventory_mode === 'limited' ? 'top-12' : 'top-3',
                                    item.hit_per_user_cap
                                        ? 'bg-ds-brown/85 border-ds-brown text-ds-cream'
                                        : 'bg-[#f2d8b7]/90 border-ds-brown/10 text-ds-brown',
                                ]"
                            >
                                {{ item.hit_per_user_cap
                                    ? $t("shop_page.per_user_cap_reached")
                                    : $t("shop_page.per_user_cap", {
                                        owned: item.user_purchased_count ?? 0,
                                        max: item.max_per_user,
                                    })
                                }}
                            </div>
                            <div class="aspect-[4/3] bg-[#ecd2ae] overflow-hidden flex items-center justify-center">
                                <img
                                    v-if="item.image_url"
                                    :src="item.image_url"
                                    :alt="item.name"
                                    class="w-full h-full object-contain p-5 transition-transform duration-300 group-hover:scale-105"
                                    :class="{ 'opacity-70 grayscale': item.coming_soon }"
                                >
                                <span v-else class="text-ds-brown/30 text-xs">{{ $t("shop_page.no_image") }}</span>
                            </div>

                            <div class="flex flex-col gap-2 min-h-[118px]">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <h3 class="font-bold text-ds-brown text-lg leading-tight">{{ item.name }}</h3>
                                    <span
                                        v-if="item.is_on_sale"
                                        class="shrink-0 border border-ds-danger bg-ds-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ds-cream"
                                    >{{ $t("shop_page.on_sale") }}</span>
                                </div>
                                <span
                                    v-if="item.category"
                                    class="text-[10px] font-bold uppercase tracking-wider text-ds-brown/45"
                                >{{ $t(`shop_page.category.${item.category}`) }}</span>
                                <p class="text-sm text-ds-brown/65 font-semibold leading-snug">
                                    {{ item.description || $t("shop_page.default_item_desc") }}
                                </p>
                                <p
                                    v-if="item.source && item.kind === 'physical'"
                                    class="text-[11px] text-ds-brown/55 italic leading-snug"
                                >
                                    {{ item.source === 'hq' ? $t("shop_page.source_hq") : $t("shop_page.source_local") }}
                                </p>
                                <span
                                    v-if="!item.coming_soon && item.kind === 'grant' && grantAmountLabel(item)"
                                    class="text-xs text-ds-brown/70 font-bold"
                                >
                                    {{ $t("shop_page.includes_value", { value: grantAmountLabel(item) }) }}
                                </span>
                                <span
                                    v-if="!item.coming_soon && item.slug === 'streak_freeze'"
                                    class="text-xs text-ds-brown/70 font-bold"
                                >
                                    {{ $t("shop_page.you_own", { count: ownedFreezes }) }}
                                </span>
                            </div>

                            <div class="mt-auto flex flex-col gap-3">
                                <div
                                    v-if="!item.coming_soon"
                                    class="flex items-center justify-between gap-3 text-sm"
                                >
                                    <span
                                        class="flex items-center gap-1 font-bold"
                                        :class="shopCardTime(item).affordable ? 'text-ds-success' : 'text-ds-brown/55'"
                                    >
                                        <Clock class="w-3.5 h-3.5 shrink-0" />
                                        {{ shopCardTime(item).text }}
                                    </span>
                                    <span class="flex items-center gap-1 text-lg font-bold text-ds-brown">
                                        <span
                                            v-if="item.is_on_sale && item.regular_price_gold"
                                            class="text-sm font-bold text-ds-brown/45 line-through mr-0.5"
                                        >{{ formatGoldCompact(item.regular_price_gold) }}</span>
                                        <img :src="'/images/icons/money.webp'" class="w-6 h-6 object-contain" alt="">
                                        <span :class="item.is_on_sale ? 'text-ds-danger' : ''">{{ formatGoldCompact(item.price_gold) }}</span>
                                    </span>
                                </div>
                                <!-- Full opacity when disabled: the ds-btn-ghost dim washes out the starfruit hint. -->
                                <button
                                    v-if="item.is_locked === true"
                                    :disabled="!isLoggedIn ? false : (starfruit < 1 || unlockingItemId === item.id)"
                                    class="w-full py-3 px-4 active:scale-95 transition-transform disabled:!opacity-100"
                                    :class="!isLoggedIn || starfruit >= 1 ? 'ds-btn-primary' : 'ds-btn-ghost'"
                                    @click="openUnlockConfirm(item)"
                                >
                                    <span class="inline-flex items-center justify-center gap-1.5">
                                        <img
                                            src="/images/fruits/starfruit.webp"
                                            class="w-4 h-4 object-contain"
                                            alt=""
                                        >
                                        {{ !isLoggedIn
                                            ? $t("shop_page.sign_in_to_unlock")
                                            : (unlockingItemId === item.id
                                                ? $t("shop_page.unlocking")
                                                : (starfruit < 1
                                                    ? $t("shop_page.locked_need_starfruit")
                                                    : $t("shop_page.locked_unlock"))) }}
                                    </span>
                                </button>
                                <button
                                    v-else
                                    class="w-full py-3 px-4 active:scale-95 transition-transform"
                                    :class="item.coming_soon || item.available_in_region === false || item.hit_per_user_cap ? 'ds-btn-ghost' : 'ds-btn-primary'"
                                    :disabled="item.coming_soon || item.available_in_region === false || item.hit_per_user_cap"
                                    @click="openPurchaseModal(item)"
                                >
                                    {{ !isLoggedIn && item.is_purchasable
                                        ? $t("shop_page.sign_in_to_buy")
                                        : (item.available_in_region === false ? $t("shop_page.not_available_in_region") : itemButtonLabel(item)) }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </component>

                    <div v-if="isLoggedIn" class="flex flex-col items-center gap-2 pt-2">

                    </div>
                </div>

                <div
                    v-else-if="currentView === 'order-detail' && selectedItem"
                    key="order-detail"
                    class="flex flex-col gap-6"
                >
                    <button
                        type="button"
                        class="text-sm text-ds-brown flex items-center gap-1 self-start hover:opacity-70 transition-opacity"
                        @click="backToShop"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                        {{ $t("shop_page.back_to_shop") }}
                    </button>

                    <Transition :css="false" appear @enter="onModalEnter">
                    <component :is="'div'">
                        <div class="flex flex-col gap-5">
                            <h2 class="text-xl sm:text-2xl font-bold text-ds-brown">{{ $t("shop_page.complete_order") }}</h2>

                            <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)] gap-6">
                                <section class="flex flex-col gap-5">
                                    <div class="aspect-[4/3] max-h-[290px] bg-[#ead3ad] border-[3px] border-ds-brown/15 overflow-hidden flex items-center justify-center">
                                        <img
                                            v-if="selectedItem.image_url"
                                            :src="selectedItem.image_url"
                                            :alt="selectedItem.name"
                                            class="w-full h-full object-contain p-6 sm:p-8"
                                        >
                                        <span v-else class="text-ds-brown/40 text-sm">{{ $t("shop_page.no_image") }}</span>
                                    </div>

                                    <div>
                                        <p class="text-[10px] uppercase tracking-wide font-bold text-ds-brown/50 mb-1">
                                            {{ $t(shopItemKindLabelKey(selectedItem.kind)) }}
                                        </p>
                                        <div class="flex items-start justify-between gap-3">
                                            <h3 class="text-3xl font-bold text-ds-brown leading-tight">{{ selectedItem.name }}</h3>
                                            <button
                                                v-if="isLoggedIn"
                                                type="button"
                                                class="shrink-0 p-2 bg-[#f2d8b7]/90 border border-ds-brown/20 hover:border-ds-brown/50 transition-colors group/star"
                                                :aria-label="isItemStarred(selectedItem)
                                                    ? $t('shop_page.unstar_aria', { name: selectedItem.name })
                                                    : $t('shop_page.star_aria', { name: selectedItem.name })"
                                                :title="isItemStarred(selectedItem) ? $t('shop_page.unstar') : $t('shop_page.star')"
                                                @click="toggleStar(selectedItem, $event)"
                                            >
                                                <Star
                                                    class="w-5 h-5 transition-colors"
                                                    :class="isItemStarred(selectedItem)
                                                        ? 'fill-ds-brown text-ds-brown'
                                                        : 'text-ds-brown/50 group-hover/star:text-ds-brown'"
                                                />
                                            </button>
                                        </div>
                                        <p class="text-sm text-ds-brown/75 font-semibold leading-snug mt-2">
                                            {{ selectedItem.description || $t("shop_page.default_item_desc") }}
                                        </p>
                                        <p
                                            v-if="selectedItem.source && selectedItem.kind === 'physical'"
                                            class="text-xs text-ds-brown/55 italic leading-snug mt-1"
                                        >
                                            {{ selectedItem.source === 'hq' ? $t("shop_page.source_hq") : $t("shop_page.source_local") }}
                                        </p>
                                    </div>

                                    <p
                                        v-if="selectedItem.kind === 'grant' && grantAmountLabel(selectedItem)"
                                        class="text-sm font-bold text-ds-brown/80 border-[2px] border-ds-brown/20 bg-white/45 px-4 py-3"
                                    >
                                        {{ $t("shop_page.grant_card_explainer", { amount: grantAmountLabel(selectedItem), item: selectedItem.name }) }}
                                    </p>

                                    <p
                                        v-else-if="selectedItem.kind === 'physical'"
                                        class="text-sm font-bold text-ds-brown/80 border-[2px] border-ds-brown/20 bg-white/45 px-4 py-3"
                                    >
                                        {{ $t("shop_page.physical_shipping_explainer") }}
                                    </p>
                                </section>

                                <section class="flex flex-col gap-5">
                                    <p
                                        v-if="selectedItem.blocked_no_shipped_project"
                                        class="bg-ds-brown/50 text-ds-cream text-center font-bold px-4 py-3"
                                    >
                                        {{ $t("shop_page.requires_ship_first_explainer") }}
                                    </p>
                                    <p v-if="purchaseError" class="text-sm text-ds-danger bg-burnt-peach-100 border-[2px] border-ds-danger/30 px-4 py-3 font-semibold">
                                        {{ purchaseError }}
                                    </p>

                                    <div
                                        v-if="selectedItem.modifiers && selectedItem.modifiers.length > 0"
                                        class="flex flex-col gap-4"
                                    >
                                        <div
                                            v-for="modifier in selectedItem.modifiers"
                                            :key="modifier.id"
                                            class="flex flex-col"
                                        >
                                            <h4 class="self-start bg-ds-brown text-ds-cream px-5 py-2 text-sm font-bold">
                                                {{ modifier.label }}
                                                <span
                                                    v-if="(modifier.type === 'single' || modifier.type === 'text') && modifier.required"
                                                    class="ml-1 text-ds-cream/70"
                                                    aria-label="required"
                                                >*</span>
                                                <span
                                                    v-if="modifier.type === 'text' && (modifier.price_delta_hours ?? 0) !== 0"
                                                    class="ml-1 text-xs text-ds-cream/70"
                                                >
                                                    ({{ (modifier.price_delta_hours ?? 0) > 0 ? '+' : '' }}{{ (modifier.price_delta_hours ?? 0) * SHOP_GOLD_PER_HOUR }}g)
                                                </span>
                                            </h4>
                                            <div
                                                v-if="modifier.type === 'text'"
                                                class="bg-white/45 border-[3px] border-ds-brown/35 p-2 flex flex-col gap-1"
                                            >
                                                <input
                                                    type="text"
                                                    :value="textModifierValue(modifier.id)"
                                                    :maxlength="Math.min(modifier.max_length ?? 64, 200)"
                                                    :placeholder="modifier.placeholder_translations?.[$i18n.locale] || modifier.placeholder || ''"
                                                    class="w-full bg-ds-cream border-[2px] border-ds-brown/15 px-4 py-3 text-sm font-bold text-ds-brown focus:outline-none focus:border-ds-brown/50 placeholder:text-ds-brown/40 placeholder:font-semibold"
                                                    @input="setTextModifier(modifier.id, $event)"
                                                >
                                                <span class="self-end text-xs font-bold text-ds-brown/55">
                                                    {{ textModifierValue(modifier.id).length }} / {{ Math.min(modifier.max_length ?? 64, 200) }}
                                                </span>
                                            </div>
                                            <div v-else class="bg-white/45 border-[3px] border-ds-brown/35 p-2 flex flex-wrap gap-2">
                                                <template v-if="modifier.type === 'single'">
                                                    <button
                                                        v-for="option in modifier.options"
                                                        :key="option.id"
                                                        type="button"
                                                        class="px-3 py-2 text-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95 border-[2px]"
                                                        :class="selectedModifiers[modifier.id] === option.id
                                                            ? 'bg-ds-cream border-ds-brown text-ds-brown'
                                                            : 'bg-white/30 border-transparent text-ds-brown/70 hover:bg-white/50'"
                                                        @click="selectSingleOption(modifier.id, option.id, modifier.required === true)"
                                                    >
                                                        {{ option.label }}
                                                        <span
                                                            v-if="option.price_delta_hours !== 0"
                                                            class="ml-1 text-xs opacity-75"
                                                        >
                                                            ({{ option.price_delta_hours > 0 ? '+' : '' }}{{ option.price_delta_hours * SHOP_GOLD_PER_HOUR }}g)
                                                        </span>
                                                    </button>
                                                </template>
                                                <template v-else>
                                                    <button
                                                        v-for="option in modifier.options"
                                                        :key="option.id"
                                                        type="button"
                                                        class="px-3 py-2 text-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95 border-[2px]"
                                                        :class="isMultiOptionSelected(modifier.id, option.id)
                                                            ? 'bg-ds-cream border-ds-brown text-ds-brown'
                                                            : 'bg-white/30 border-transparent text-ds-brown/70 hover:bg-white/50'"
                                                        @click="toggleMultiOption(modifier.id, option.id)"
                                                    >
                                                        <span class="mr-1 text-xs opacity-70">
                                                            {{ isMultiOptionSelected(modifier.id, option.id) ? '☑' : '☐' }}
                                                        </span>
                                                        {{ option.label }}
                                                        <span
                                                            v-if="option.price_delta_hours !== 0"
                                                            class="ml-1 text-xs opacity-75"
                                                        >
                                                            ({{ option.price_delta_hours > 0 ? '+' : '' }}{{ option.price_delta_hours * SHOP_GOLD_PER_HOUR }}g)
                                                        </span>
                                                    </button>
                                                </template>
                                            </div>
                                        </div>
                                    </div>

                                    <label v-if="hasQuantitySelector" class="flex flex-col">
                                        <span class="self-start bg-ds-brown text-ds-cream px-5 py-2 text-sm font-bold">
                                            {{ $t("shop_page.quantity") }}
                                        </span>
                                        <div class="bg-white/45 border-[3px] border-ds-brown/35 p-2">
                                            <input
                                                v-model.number="purchaseQuantity"
                                                type="number"
                                                min="1"
                                                :max="effectivePurchaseMax"
                                                class="w-full bg-ds-cream border-[2px] border-ds-brown/15 px-4 py-3 text-sm font-bold text-ds-brown focus:outline-none focus:border-ds-brown/50"
                                                @focus="selectPurchaseQuantity"
                                                @blur="normalizePurchaseQuantity"
                                            >
                                        </div>
                                        <span class="bg-white/45 px-4 pb-3 text-xs font-bold text-ds-brown/55">
                                            {{ $t("shop_page.max_per_order", { max: effectivePurchaseMax }) }}
                                        </span>
                                    </label>

                                    <div
                                        v-if="purchaseRequiresCheckoutAddress"
                                        class="flex flex-col"
                                    >
                                        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <h4 class="self-start bg-ds-brown text-ds-cream px-5 py-2 text-sm font-bold">
                                                {{ $t(purchaseAddressLabelKey) }}
                                            </h4>
                                            <div class="flex items-center gap-3 sm:justify-end">
                                                <a
                                                    href="https://auth.hackclub.com/addresses"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="text-xs font-bold text-ds-brown underline hover:opacity-70"
                                                >
                                                    {{ $t("shop_page.edit_addresses") }}
                                                </a>
                                                <button
                                                    class="text-xs font-bold text-ds-brown underline hover:opacity-70 disabled:opacity-60"
                                                    :disabled="addressAuthorizing"
                                                    @click="requestCheckoutAddress"
                                                >
                                                    {{ addressAuthorizing ? $t("shop_page.redirecting") : checkoutAddresses.length ? $t("shop_page.update_addresses") : $t("shop_page.load_addresses") }}
                                                </button>
                                            </div>
                                        </div>

                                        <div
                                            v-if="checkoutAddresses.length"
                                            class="border-[3px] border-ds-brown/60 bg-parchment/80 p-2 flex flex-col gap-2"
                                        >
                                            <button
                                                v-for="address in checkoutAddresses"
                                                :key="address.id"
                                                class="w-full text-left px-3 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] border-[2px]"
                                                :class="address.id === selectedCheckoutAddress?.id
                                                    ? 'bg-ds-cream border-ds-brown text-ds-brown'
                                                    : 'bg-white/30 border-transparent text-ds-brown/70 hover:bg-white/50'"
                                                @click="selectedCheckoutAddressId = address.id"
                                            >
                                                <span class="block">
                                                    {{ shortAddressLabel(address) }}
                                                    <span v-if="address.primary" class="text-xs text-ds-success">{{ $t("shop_page.primary_tag") }}</span>
                                                </span>
                                                <span class="block text-xs opacity-75">
                                                    {{ addressLocationLabel(address) }}
                                                </span>
                                            </button>
                                        </div>

                                        <div
                                            v-else
                                            class="border-[3px] border-ds-brown/20 bg-white/45 px-4 py-4 flex flex-col gap-3"
                                        >
                                            <p class="text-sm text-ds-brown/80 font-semibold">
                                                {{ $t("shop_page.authorize_addresses") }}
                                            </p>
                                            <button
                                                class="self-start ds-btn-primary"
                                                :disabled="addressAuthorizing"
                                                @click="requestCheckoutAddress"
                                            >
                                                {{ addressAuthorizing ? $t("shop_page.redirecting") : $t("shop_page.authorize") }}
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Physical items only: the only kind a human packs and ships. -->
                                    <div
                                        v-if="selectedItem.kind === 'physical'"
                                        class="flex flex-col"
                                    >
                                        <h4 class="self-start bg-ds-brown text-ds-cream px-5 py-2 text-sm font-bold">
                                            {{ $t("shop_page.fulfillment_note_label") }}
                                        </h4>
                                        <div class="bg-white/45 border-[3px] border-ds-brown/35 p-2 flex flex-col gap-1">
                                            <textarea
                                                v-model="fulfillmentNote"
                                                :maxlength="SHOP_NOTE_MAX_LENGTH"
                                                rows="3"
                                                :placeholder="$t('shop_page.fulfillment_note_placeholder')"
                                                class="w-full bg-ds-cream border-[2px] border-ds-brown/15 px-4 py-3 text-sm font-bold text-ds-brown focus:outline-none focus:border-ds-brown/50 placeholder:text-ds-brown/40 placeholder:font-semibold resize-none"
                                            />
                                            <span class="self-end text-xs font-bold text-ds-brown/55">
                                                {{ fulfillmentNote.length }} / {{ SHOP_NOTE_MAX_LENGTH }}
                                            </span>
                                        </div>
                                        <span class="bg-white/45 px-4 pb-3 text-xs font-bold text-ds-brown/55">
                                            {{ $t("shop_page.fulfillment_note_help") }}
                                        </span>
                                    </div>

                                    <div class="flex flex-col">
                                        <h4 class="self-start bg-ds-success text-ds-cream px-5 py-2 text-sm font-bold">
                                            {{ $t("shop_page.order_summary") }}
                                        </h4>
                                        <div class="bg-[#edf0c4] border-[3px] border-ds-success/80 p-4 text-ds-success font-bold flex flex-col gap-2">
                                            <div class="flex items-center justify-between gap-4">
                                                <span>{{ $t("shop_page.base_price") }}</span>
                                                <span class="flex items-center gap-1 text-ds-brown">
                                                    <span
                                                        v-if="summaryOnSale && summaryRegularGold"
                                                        class="text-ds-brown/45 line-through mr-0.5"
                                                    >{{ formatGoldCompact(summaryRegularGold) }}</span>
                                                    <img :src="'/images/icons/money.webp'" class="w-5 h-5 object-contain" alt="">
                                                    {{ formatGoldCompact(unitBaseGold) }}
                                                </span>
                                            </div>
                                            <div
                                                v-if="selectedModifierDeltaGold !== 0"
                                                class="flex items-center justify-between gap-4"
                                            >
                                                <span>Modifiers</span>
                                                <span class="flex items-center gap-1 text-ds-brown">
                                                    <img :src="'/images/icons/money.webp'" class="w-5 h-5 object-contain" alt="">
                                                    {{ selectedModifierDeltaGold > 0 ? '+' : '' }}{{ formatGoldCompact(selectedModifierDeltaGold) }}
                                                </span>
                                            </div>
                                            <div class="flex items-center justify-between gap-4">
                                                <span>{{ $t("shop_page.quantity_label") }}</span>
                                                <span class="text-ds-brown">{{ purchaseQuantity }}x</span>
                                            </div>
                                            <div class="flex items-center justify-between gap-4 pt-2 border-t-[2px] border-ds-success/40">
                                                <span>{{ $t("shop_page.total") }}</span>
                                                <span class="flex items-center gap-1 text-ds-brown">
                                                    <img :src="'/images/icons/money.webp'" class="w-5 h-5 object-contain" alt="">
                                                    {{ formatGoldCompact(selectedTotalGold) }}
                                                </span>
                                            </div>
                                        </div>
                                        <div class="bg-[#edf0c4]/80 px-4 py-2 text-center text-sm font-bold text-ds-success">
                                            {{ $t("shop_page.current_balance") }}
                                            <span class="inline-flex items-center gap-1 text-ds-brown">
                                                <img :src="'/images/icons/money.webp'" class="w-4 h-4 object-contain" alt="">
                                                {{ formatGold(selectionSpendableGold) }}
                                            </span>
                                        </div>
                                    </div>

                                    <!-- Explains why the price differs from the browse-region price on the card. -->
                                    <p
                                        v-if="activeRegionQuote?.region_price_differs && activeRegionQuote?.order_region"
                                        class="bg-white/45 border-[3px] border-ds-brown/20 text-ds-brown/80 text-center text-xs font-bold px-4 py-2"
                                    >
                                        {{ activeRegionQuote?.order_region ? $t("shop_page.priced_for_shipping", { region: REGION_LABELS[activeRegionQuote.order_region] }) : "" }}
                                    </p>

                                    <p
                                        v-if="shippingRegionUnavailable"
                                        class="bg-ds-danger/80 text-ds-cream text-center font-bold px-4 py-3"
                                    >
                                        {{ $t("shop_page.unavailable_shipping_region", { region: activeRegionQuote?.order_region ? REGION_LABELS[activeRegionQuote.order_region] : '' }) }}
                                    </p>

                                    <p
                                        v-else-if="!canAffordSelection"
                                        class="bg-ds-brown/50 text-ds-cream text-center font-bold px-4 py-3"
                                    >
                                        {{ $t("shop_page.need_more_gold", { count: formatGoldCompact(selectedTotalGold - selectionSpendableGold) }) }}
                                    </p>

                                    <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
                                        <button
                                            class="px-4 py-2 text-sm font-bold text-ds-brown border-[2px] border-ds-brown/20 bg-white/45 active:scale-95 transition-transform"
                                            @click="backToShop"
                                        >
                                            {{ $t("common.cancel") }}
                                        </button>
                                        <button
                                            class="ds-btn-primary active:scale-95 transition-transform"
                                            :disabled="purchasing || !canSubmitPurchase"
                                            @click="submitPurchase"
                                        >
                                            {{ purchasing
                                                ? $t("shop_page.purchasing")
                                                : selectedItem.blocked_no_shipped_project
                                                    ? $t("shop_page.requires_ship_first")
                                                    : selectedTotalGold === 0
                                                        ? $t("shop_page.get_for_free")
                                                        : $t("shop_page.buy_for_gold", { gold: formatGoldCompact(selectedTotalGold) }) }}
                                        </button>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </component>
                    </Transition>
                </div>

                <div
                    v-else-if="currentView === 'my-orders'"
                    key="my-orders"
                    class="flex flex-col gap-6"
                >
                    <button
                        type="button"
                        class="text-sm text-ds-brown flex items-center gap-1 self-start hover:opacity-70 transition-opacity"
                        @click="backToShop"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                        {{ $t("shop_page.back_to_shop") }}
                    </button>

                    <component :is="'div'">
                        <div class="flex flex-col gap-4">
                            <h2 class="text-lg sm:text-xl font-bold text-ds-brown">{{ $t("shop_page.my_orders") }}</h2>

                            <div class="flex flex-col gap-3">
                                <p v-if="myOrdersLoading" class="text-sm text-ds-brown/70">
                                    {{ $t("shop_page.my_orders_loading") }}
                                </p>
                                <p v-else-if="myOrdersError" class="text-sm text-red-700">
                                    {{ $t("shop_page.my_orders_error") }}
                                </p>
                                <p v-else-if="!myOrders || myOrders.length === 0" class="text-sm text-ds-brown/70">
                                    {{ $t("shop_page.my_orders_empty") }}
                                </p>
                                <div
                                    v-for="row in (myOrders ?? [])"
                                    :key="row.order.id"
                                    class="flex gap-3 p-3 border-[2px] border-ds-brown/15 bg-white/40"
                                >
                                    <img
                                        v-if="row.order.item_snapshot?.image_url"
                                        :src="row.order.item_snapshot.image_url"
                                        :alt="row.order.item_snapshot.name"
                                        class="w-14 h-14 object-contain shrink-0"
                                    >
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-start justify-between gap-2">
                                            <p class="text-sm font-bold text-ds-brown truncate">
                                                {{ row.order.item_snapshot?.name }}
                                            </p>
                                            <span
                                                class="shrink-0 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 border"
                                                :class="{
                                                    'bg-amber-100 text-amber-900 border-amber-300': statusMeta(row.order.status, row.order.item_snapshot?.slug).tone === 'amber',
                                                    'bg-green-100 text-green-900 border-green-300': statusMeta(row.order.status, row.order.item_snapshot?.slug).tone === 'green',
                                                    'bg-red-100 text-red-900 border-red-300': statusMeta(row.order.status, row.order.item_snapshot?.slug).tone === 'red',
                                                }"
                                            >
                                                {{ $t(statusMeta(row.order.status, row.order.item_snapshot?.slug).key) }}
                                            </span>
                                        </div>
                                        <p class="text-xs text-ds-brown/70 mt-1">
                                            {{ $t("shop_page.order_quantity", { n: row.order.quantity }) }}
                                            · {{ new Date(row.order.created_at).toLocaleDateString() }}
                                        </p>
                                        <ul
                                            v-if="row.order.item_snapshot?.selected_modifiers && row.order.item_snapshot.selected_modifiers.length > 0"
                                            class="mt-1 flex flex-col gap-0.5"
                                        >
                                            <li
                                                v-for="modifier in row.order.item_snapshot.selected_modifiers"
                                                :key="modifier.modifier_id"
                                                class="text-xs text-ds-brown/80"
                                            >
                                                <span class="text-ds-brown/55">{{ modifier.modifier_label }}:</span>
                                                {{ modifier.options.map((opt) => opt.label).join(", ") }}
                                            </li>
                                        </ul>
                                        <p v-if="row.order.tracking_number" class="text-xs text-ds-brown/70 mt-1">
                                            {{ $t("shop_page.order_tracking") }}: {{ row.order.tracking_number }}
                                        </p>
                                        <div v-if="row.order.fulfillment_note" class="mt-1">
                                            <p class="text-[10px] uppercase tracking-wide font-bold text-ds-brown/55">
                                                {{ $t("shop_page.fulfillment_note_label") }}
                                            </p>
                                            <PlainTextWithLinks
                                                :text="row.order.fulfillment_note"
                                                class="text-xs text-ds-brown/80 break-words"
                                            />
                                        </div>
                                        <p v-if="row.order.status === 'external_failure'" class="text-xs text-red-700 mt-1">
                                            {{ $t("shop_page.order_failure_note") }}
                                        </p>
                                        <button
                                            v-if="isOrderUserCancellable(row.order.status)"
                                            type="button"
                                            class="ds-btn-danger mt-2 text-xs px-3 py-1 self-start"
                                            :disabled="cancelling && cancelTargetId === row.order.id"
                                            @click="openCancelConfirm(row.order.id)"
                                        >
                                            {{ $t("shop_page.cancel_order") }}
                                        </button>
                                    </div>
                                </div>
                                <p v-if="cancelError" class="text-sm text-red-700">{{ cancelError }}</p>
                            </div>
                        </div>
                    </component>

                    <ConfirmationModal
                        :open="cancelTargetId !== null"
                        variant="danger"
                        :title="$t('shop_page.cancel_order_title')"
                        :message="$t('shop_page.cancel_order_message')"
                        :confirm-text="$t('shop_page.cancel_order_confirm')"
                        :cancel-text="$t('common.back')"
                        @confirm="confirmCancelOrder"
                        @cancel="closeCancelConfirm"
                    />
                </div>
                <div
                    v-else-if="currentView === 'currency'"
                    key="currency"
                    class="flex flex-col gap-6"
                >
                    <div class="flex items-center justify-between gap-4 w-full flex-wrap">
                        <button
                            type="button"
                            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
                            @click="backToShop"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            {{ $t("shop_page.back_to_shop") }}
                        </button>
                        <a
                            href="/currency"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
                        >
                            {{ $t("currency_page.open_in_new_tab") }}
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>

                    <div>
                        <CurrencyGuide embedded />
                    </div>
                </div>

            </Transition>

            <ConfirmationModal
                :open="unlockConfirmItem !== null"
                variant="info"
                :title="$t('shop_page.unlock_confirm_title', { item: unlockConfirmItem?.name ?? '' })"
                :message="$t('shop_page.unlock_confirm_message', { item: unlockConfirmItem?.name ?? '' })"
                :confirm-text="$t('shop_page.unlock_confirm_cta')"
                :cancel-text="$t('common.back')"
                @confirm="confirmUnlock"
                @cancel="closeUnlockConfirm"
            />
        </div>
    </div>
</template>

<style scoped>
/* mode="out-in" runs the two halves in sequence, so each gets its own 160ms. */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
    transition:
        transform 0.16s cubic-bezier(0.22, 1, 0.36, 1),
        opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform, opacity;
}
.slide-left-enter-from {
    transform: translateX(24px);
    opacity: 0;
}
.slide-left-leave-to {
    transform: translateX(-24px);
    opacity: 0;
}
.slide-right-enter-from {
    transform: translateX(-24px);
    opacity: 0;
}
.slide-right-leave-to {
    transform: translateX(24px);
    opacity: 0;
}

/* CSS rather than GSAP: a continuous loop tied to a boolean state. */
@keyframes convert-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(104, 77, 58, 0.35); }
    50%      { box-shadow: 0 0 0 6px rgba(104, 77, 58, 0); }
}
.is-converting {
    animation: convert-pulse 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
    .is-converting {
        animation: none;
    }
}
</style>
