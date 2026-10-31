<script setup lang="ts">
import { formatGold } from "~/utils/formatGold";

definePageMeta({
    layout: false,
});

const { t } = useI18n();

useSeoMeta({
    title: () => t("event_page.seo.title"),
    description: () => t("event_page.seo.description"),
    ogTitle: () => t("event_page.seo.ogTitle"),
    ogDescription: () => t("event_page.seo.description"),
    ogType: "website",
    twitterCard: "summary_large_image",
});


const PARENT_GUIDE_URL =
    "https://docs.google.com/document/d/1d5U6ghcQ7bTcDZYKWEddcjryAVB7d6rIDgIrXQJpgCg/edit";

type EventStatus = {
    item: {
        id: number;
        price_gold: number;
        price_hours: number;
        available: boolean;
        coming_soon: boolean;
    } | null;
    isLoggedIn: boolean;
    gold: number;
    hasShipped: boolean | null;
    alreadyPurchased: boolean;
    hasCertificate: boolean;
    certificateCode: string | null;
    approvedHours: number;
    qualifyHours: number;
    autoQualified: boolean;
};

const {
    data: eventStatus,
    pending: eventStatusPending,
    error: eventStatusError,
    refresh: refreshEventStatus,
} = await useFetch<EventStatus>("/api/event/status", {
    key: "event-status",
    lazy: true,
    server: false,
    default: () => ({
        item: null,
        isLoggedIn: false,
        gold: 0,
        hasShipped: null,
        alreadyPurchased: false,
        hasCertificate: false,
        certificateCode: null,
        approvedHours: 0,
        qualifyHours: 0,
        autoQualified: false,
    }),
});

// display-only fallback until the status lands; the real value is EVENT_QUALIFY_HOURS in
// server/lib/event-auto-qualify.ts.
const qualifyHours = computed(() => eventStatus.value?.qualifyHours || 50); // free-seat hours fallback

const item = computed(() => eventStatus.value?.item ?? null);
const priceGold = computed(() => item.value?.price_gold ?? 1000); // fallback price until the status loads

// the status fetch is client-only, so the buy state is gated on mount to keep hydration matching.
const mounted = ref(false);

const fruitIcons = [
    "/images/fruits/avocado/icon_exterior.webp",
    "/images/fruits/avocado/icon_interior.webp",
    "/images/fruits/mango/icon.webp",
    "/images/fruits/papaya/icon_exterior.webp",
    "/images/fruits/papaya/icon_interior.webp",
    "/images/fruits/guava/icon_exterior.webp",
    "/images/fruits/guava/icon_interior.webp",
    "/images/fruits/pineapple/icon.webp",
    "/images/fruits/cocoa/icon_exterior.webp",
    "/images/fruits/cocoa/icon_interior.webp",
    "/images/fruits/coco/icon_exterior.webp",
    "/images/fruits/coco/icon_interior.webp",
    "/images/fruits/watermelon/icon_exterior.webp",
    "/images/fruits/watermelon/icon_interior.webp",
];

// positions are generated client-side: randomising during SSR causes a hydration mismatch that freezes navigations.
const contentSection = ref<HTMLElement | null>(null);
const scatteredFruits = ref<
    Array<{ src: string; top: string; left: string; rotation: number; size: number }>
>([]);

onMounted(() => {
    mounted.value = true;

    // jittered 4x8 grid; top is in px so a fruit stays put when the FAQ below expands.
    const height = contentSection.value?.offsetHeight ?? window.innerHeight * 4;
    const cols = 4;
    const rows = 8;
    const jitter = 0.45;

    scatteredFruits.value = Array.from({ length: cols * rows }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const jx = ((Math.random() - 0.5) * jitter) / cols;
        const jy = ((Math.random() - 0.5) * jitter) / rows;
        const leftFrac = (col + 0.5) / cols + jx;
        const topFrac = 0.06 + ((row + 0.5) / rows + jy) * 0.88;
        return {
            // Stride 7 so neighbouring cells never land on the same icon.
            src: fruitIcons[(i * 7) % fruitIcons.length]!,
            top: `${Math.round(topFrac * height)}px`,
            left: `${(2 + leftFrac * 96).toFixed(2)}%`,
            rotation: Math.random() * 360,
            size: 36 + Math.random() * 44,
        };
    });
});

// signed out: plain login with no return_to (like useAuth.signIn()) so it lands them home.
const ctaHref = computed(() =>
    eventStatus.value?.isLoggedIn ? "/" : "/api/auth/login",
);

// mirrors the gates in server/api/shop/orders.post.ts rather than trusting a full bar.
const canBuyTicket = computed(() => {
    const s = eventStatus.value;
    if (!s || !mounted.value || eventStatusPending.value || eventStatusError.value) return false;
    if (!s.item || s.item.available === false || s.item.coming_soon) return false;
    if (!s.isLoggedIn || s.alreadyPurchased) return false;
    return s.gold >= priceGold.value;
});

// fixed 50 gold/hour rate (~20h for the 1,000-gold ticket), not price_hours; keep in sync with shop.vue
const ticketHoursTotal = computed(() =>
    Math.max(1, Math.ceil(priceGold.value / 50)), // event ticket gold per hour
);

// same payload as the shop banner and HUD widget; shapes match EventProgressWidget.vue.
const hoursTrack = computed(() => {
    const s = eventStatus.value;
    if (!s || s.qualifyHours <= 0) return null;
    return {
        earned: Math.round(s.approvedHours * 10) / 10,
        total: s.qualifyHours,
        pct: Math.round((Math.min(s.approvedHours, s.qualifyHours) / s.qualifyHours) * 100),
        remaining: Math.max(0, Math.round((s.qualifyHours - s.approvedHours) * 10) / 10),
    };
});

const goldTrack = computed(() => {
    const s = eventStatus.value;
    const price = priceGold.value;
    if (!s || price <= 0) return null;
    return {
        earned: s.gold,
        total: price,
        pct: Math.round((Math.min(s.gold, price) / price) * 100),
        remaining: Math.max(0, price - s.gold),
    };
});

// signed out the endpoint returns zeroes, so plain targets replace the empty bars.
const showPersonalTracks = computed(() => mounted.value && !!eventStatus.value?.isLoggedIn);

// pulled live from the shop catalogue so prices can never drift from checkout.
type EventShopItem = {
    id: number;
    slug?: string | null;
    name: string;
    description: string | null;
    image_url: string | null;
    price_gold: number;
    coming_soon?: boolean;
    is_expired?: boolean;
    is_sold_out?: boolean;
    available_in_region?: boolean;
};

// ordered deliberately: the ticket is the ask, the stipend answers "I cannot afford to get there".
const HACKATHON_SLUGS = ["event_invite", "travel_stipend"] as const;

const shopCatalog = useShopCatalog();
const { data: shopCatalogue } = await useAsyncData<{ items: EventShopItem[] }>(
    "event-shop-items",
    () => shopCatalog.fetch<{ items: EventShopItem[] }>(),
    {
        lazy: true,
        server: false,
        default: () => ({ items: [] }),
    },
);

// the catalog already filters available=true; not gated on is_purchasable so logged-out and
// not-yet-shipped viewers still see the item and get the shop's own messaging.
const hackathonItems = computed(() =>
    HACKATHON_SLUGS.map((slug) =>
        (shopCatalogue.value?.items ?? []).find((entry) => entry.slug === slug),
    ).filter(
        (entry): entry is EventShopItem =>
            !!entry &&
            entry.coming_soon !== true &&
            entry.is_expired !== true &&
            entry.is_sold_out !== true &&
            entry.available_in_region !== false,
    ),
);

// reuses the shop's purchase modal so region pricing, billing address and ID verification stay in one place.
function purchaseHref(item: EventShopItem): string {
    return `/shop?purchaseItem=${item.id}`;
}

const buying = ref(false);
const buyError = ref("");

async function buyTicket() {
    if (!item.value || buying.value) return;
    buying.value = true;
    buyError.value = "";
    try {
        await $fetch("/api/shop/orders", {
            method: "POST",
            body: { itemId: item.value.id, quantity: 1 },
        });
        // server guards win over stale client state via the catch below.
        await refreshEventStatus();
    } catch (err: unknown) {
        buyError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t("event_page.buy.error_generic");
    } finally {
        buying.value = false;
    }
}

</script>

<template>
    <div class="min-h-screen bg-parchment">
        <div ref="contentSection" class="relative w-full overflow-x-clip">
            <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
                <div
                    v-for="(fruit, i) in scatteredFruits"
                    :key="'fruit-' + i"
                    class="absolute opacity-40"
                    :style="{
                        top: fruit.top,
                        left: fruit.left,
                        transform: `rotate(${fruit.rotation}deg)`,
                    }"
                >
                    <img
                        :src="fruit.src"
                        :style="{ width: fruit.size + 'px', height: fruit.size + 'px' }"
                        class="object-contain"
                        alt=""
                    >
                </div>
            </div>

        <div class="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
            <NuxtLink
                to="/"
                class="text-sm text-ds-brown underline self-start"
            >
                {{ $t("event_page.footer.home") }}
            </NuxtLink>

            <!-- shown whole beside the text: cropping the portrait poster cut the painting and its wordmark -->
            <section class="flex flex-col gap-8 md:flex-row md:items-center md:gap-12">
                <picture class="block shrink-0 md:w-[42%]">
                    <source srcset="/images/event/welcome.avif" type="image/avif">
                    <img
                        src="/images/event/welcome.webp"
                        :alt="$t('event_page.hero.artwork_alt')"
                        class="mx-auto block h-auto w-auto max-h-[58vh] max-w-full -rotate-2 shadow-xl"
                        loading="eager"
                        decoding="async"
                    >
                </picture>

                <div class="flex flex-col gap-3">
                    <p class="text-xs font-bold uppercase tracking-widest text-ds-brown/60">
                        {{ $t("event_page.hero.kicker") }}
                    </p>
                    <h1 class="font-bold text-3xl sm:text-4xl text-ds-brown leading-tight">
                        {{ $t("event_page.hero.title") }}
                    </h1>
                    <p class="text-base font-bold text-ds-brown">
                        {{ $t("event_page.hero.date") }} &middot; {{ $t("event_page.hero.location") }}
                    </p>
                    <p class="text-base sm:text-lg text-ds-brown/85 leading-relaxed">
                        {{ $t("event_page.hero.blurb") }}
                    </p>
                    <p class="text-sm text-ds-brown/70">
                        {{ $t("event_page.hero.eligibility") }}
                    </p>

                    <!-- plain anchor: the logged-out target is a server auth route, not a Nuxt page -->
                    <a
                        :href="ctaHref"
                        class="ds-btn-primary mt-2 self-start px-6 py-3 text-base"
                    >
                        {{ $t("event_page.cta_earn") }}
                    </a>
                </div>
            </section>

            <section class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <h2 class="font-bold text-xl sm:text-2xl text-ds-brown">
                        {{ $t("event_page.ways.heading") }}
                    </h2>
                    <p class="text-sm text-ds-brown/80 max-w-2xl leading-relaxed">
                        {{ $t("event_page.ways.subline") }}
                    </p>
                </div>

                <!-- signed out, plain targets replace the bars since personal numbers would all be zero -->
                <div v-if="showPersonalTracks" class="flex flex-col gap-6 max-w-2xl">
                    <div v-if="hoursTrack" class="flex flex-col gap-1.5">
                        <p class="font-bold text-ds-brown">
                            {{ $t("event_page.ways.hours_label", { threshold: qualifyHours }) }}
                        </p>
                        <div class="flex items-center justify-between text-sm font-bold text-ds-brown">
                            <span>{{ $t("shop_page.event_bar.hours_label", { earned: hoursTrack.earned, total: hoursTrack.total }) }}</span>
                            <span class="text-ds-brown/55 font-medium">{{ hoursTrack.pct }}%</span>
                        </div>
                        <div class="w-full h-5 bg-ds-brown/15 border-[2px] border-ds-brown overflow-hidden">
                            <div
                                class="h-full bg-ds-brown transition-all duration-500"
                                :style="{ width: hoursTrack.pct + '%' }"
                            />
                        </div>
                        <p
                            class="text-sm"
                            :class="eventStatus?.autoQualified ? 'text-ds-success font-bold' : 'text-ds-brown/80'"
                        >
                            {{
                                eventStatus?.autoQualified
                                    ? $t("event_page.ways.qualified", { threshold: hoursTrack.total })
                                    : $t("event_page.ways.hours_left", { hours: hoursTrack.remaining })
                            }}
                        </p>
                    </div>

                    <div v-if="goldTrack" class="flex flex-col gap-1.5">
                        <p class="font-bold text-ds-brown">{{ $t("event_page.ways.gold_label") }}</p>
                        <div class="flex items-center justify-between text-sm font-bold text-ds-brown">
                            <span>{{ $t("shop_page.event_bar.gold_label", { earned: goldTrack.earned, total: goldTrack.total }) }}</span>
                            <span class="text-ds-brown/55 font-medium">{{ goldTrack.pct }}%</span>
                        </div>
                        <div class="w-full h-5 bg-ds-brown/15 border-[2px] border-ds-brown overflow-hidden">
                            <div
                                class="h-full bg-ds-gold transition-all duration-500"
                                :style="{ width: goldTrack.pct + '%' }"
                            />
                        </div>
                        <p
                            class="text-sm"
                            :class="goldTrack.remaining === 0 ? 'text-ds-success font-bold' : 'text-ds-brown/80'"
                        >
                            {{
                                goldTrack.remaining === 0
                                    ? $t("event_page.ways.can_buy")
                                    : $t("event_page.ways.gold_left", { gold: formatGold(goldTrack.remaining) })
                            }}
                        </p>
                    </div>

                    <!-- one action for both routes; the free-seat case gets a status line since the server
                         grants that invite and there is no claim endpoint -->
                    <div v-if="eventStatus?.alreadyPurchased" class="flex flex-col gap-1">
                        <p class="text-lg font-bold text-ds-success">
                            {{ $t("event_page.buy.going.title") }}
                        </p>
                        <p class="text-sm text-ds-brown/80">{{ $t("event_page.buy.going.body") }}</p>
                    </div>

                    <div v-else-if="canBuyTicket" class="flex flex-col gap-2">
                        <button
                            type="button"
                            :disabled="buying"
                            class="ds-btn-success self-start px-6 py-3 text-base transition-transform active:scale-95 disabled:opacity-60"
                            @click="buyTicket"
                        >
                            {{ buying ? $t("event_page.buy.buying") : $t("event_page.ways.get_ticket") }}
                        </button>
                        <p v-if="buyError" class="text-sm font-medium text-ds-danger">{{ buyError }}</p>
                    </div>

                    <p
                        v-else-if="eventStatus?.autoQualified"
                        class="text-base font-bold text-ds-success"
                    >
                        {{ $t("event_page.ways.free_seat_granted") }}
                    </p>
                </div>

                <div v-else class="flex flex-col gap-5 max-w-2xl">
                    <div class="flex flex-col gap-0.5">
                        <p class="font-bold text-ds-brown">
                            {{ $t("event_page.ways.hours_label", { threshold: qualifyHours }) }}
                        </p>
                        <p class="text-sm text-ds-brown/75 leading-relaxed">
                            {{ $t("event_page.ways.hours_free", { threshold: qualifyHours }) }}
                        </p>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <p class="font-bold text-ds-brown">{{ $t("event_page.ways.gold_label") }}</p>
                        <p class="text-sm text-ds-brown/75 leading-relaxed">
                            {{ $t("event_page.ways.gold_note", { gold: formatGold(priceGold), hours: ticketHoursTotal }) }}
                        </p>
                    </div>
                </div>

                <div
                    v-if="hackathonItems.length"
                    class="max-w-2xl divide-y divide-ds-brown/25 border-y border-ds-brown/25"
                >
                    <div
                        v-for="entry in hackathonItems"
                        :key="entry.id"
                        class="flex items-center gap-4 py-4"
                    >
                        <img
                            v-if="entry.image_url"
                            :src="entry.image_url"
                            alt=""
                            class="h-14 w-14 shrink-0 object-contain"
                            loading="lazy"
                            decoding="async"
                        >
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <p class="font-bold text-ds-brown">{{ entry.name }}</p>
                            <p class="text-sm text-ds-brown/70">
                                {{ $t("event_page.ways.item_price", { gold: formatGold(entry.price_gold) }) }}
                            </p>
                        </div>
                        <NuxtLink
                            :to="purchaseHref(entry)"
                            class="ds-btn-primary ml-auto shrink-0 px-4 py-2.5 text-sm"
                        >
                            {{ $t("event_page.ways.item_cta") }}
                        </NuxtLink>
                    </div>
                </div>

                <div class="flex flex-col gap-0.5 max-w-2xl">
                    <p class="font-bold text-ds-brown">{{ $t("event_page.ways.stipend_heading") }}</p>
                    <p class="text-sm text-ds-brown/75 leading-relaxed">
                        {{ $t("event_page.ways.stipend_body") }}
                    </p>
                </div>
            </section>

            <section class="py-2">
                <div
                    class="paper-sheet mx-auto max-w-2xl -rotate-1 px-7 py-9 shadow-xl sm:px-12 sm:py-14"
                >
                    <p class="font-satoro text-base sm:text-lg leading-relaxed text-ds-brown">
                        {{ $t("event_page.letter.p1") }}
                    </p>
                    <p class="font-satoro mt-5 text-base sm:text-lg leading-relaxed text-ds-brown">
                        {{ $t("event_page.letter.p2") }}
                    </p>
                    <p
                        class="font-satoro mt-5 text-base sm:text-lg leading-relaxed text-ds-brown font-bold"
                    >
                        {{ $t("event_page.letter.p3") }}
                    </p>
                </div>
            </section>

            <div class="flex justify-center py-2">
                <a
                    :href="PARENT_GUIDE_URL"
                    target="_blank"
                    rel="noreferrer"
                    class="ds-btn-primary px-8 py-4 text-lg"
                >
                    {{ $t("event_page.parent_guide.button") }}
                </a>
            </div>

            <footer class="flex flex-col gap-3 pt-2 pb-8 text-sm text-ds-brown/70">
                <div class="flex flex-wrap gap-x-6 gap-y-2">
                    <a :href="PARENT_GUIDE_URL" target="_blank" rel="noreferrer" class="underline hover:text-ds-brown">
                        {{ $t("event_page.footer.parent_guide") }}
                    </a>
                    <NuxtLink to="/shop" class="underline hover:text-ds-brown">
                        {{ $t("event_page.footer.shop") }}
                    </NuxtLink>
                    <NuxtLink to="/" class="underline hover:text-ds-brown">
                        {{ $t("event_page.footer.home") }}
                    </NuxtLink>
                </div>
                <a
                    href="https://hackclub.com?utm_source=macondo"
                    target="_blank"
                    rel="noreferrer"
                    class="underline self-start"
                    style="color: #ec3750"
                >
                    {{ $t("event_page.footer.brought_by") }}
                </a>
            </footer>
        </div>
        </div>
    </div>
</template>

<style scoped>
/* WebP base for every browser; image-set upgrades to the much smaller AVIF where supported */
.paper-sheet {
    background-image: url("/images/landing/paper.webp");
    background-size: cover;
    background-position: center;
}

@supports (background-image: image-set(url("/images/landing/paper.avif") type("image/avif"))) {
    .paper-sheet {
        background-image: image-set(
            url("/images/landing/paper.avif") type("image/avif"),
            url("/images/landing/paper.webp") type("image/webp")
        );
    }
}
</style>
