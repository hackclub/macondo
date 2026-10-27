<script setup lang="ts">
import { shopHourDisplay } from "~/utils/shopHourDisplay";

type MarqueeShopItem = {
  id: number | string;
  name: string;
  image_url: string | null;
  price_hours: number;
  price_gold: number;
  available: boolean;
  coming_soon: boolean;
  available_in_region?: boolean;
};

type MarqueeShopItemsResponse = {
  items: MarqueeShopItem[];
  region: string;
};

const { locale, t } = useI18n();

// client-only, not just lazy: an SSR fetch serializes the catalog into every page's
// __NUXT__ payload, readable without auth and bypassing the catalog gate
const shopCatalog = useShopCatalog();
const { data: response } = useAsyncData<MarqueeShopItemsResponse>(
  "marquee-shop-items",
  () => shopCatalog.fetch<MarqueeShopItemsResponse>({ locale: locale.value }),
  {
    server: false,
    lazy: true,
    // useAsyncData needs the dependency named so switching language re-fetches
    watch: [locale],
    default: () => ({ items: [], region: "NA" }),
  },
);
const items = computed<MarqueeShopItem[]>(() => response.value?.items ?? []);

function shopTimeLabel(priceGold: number): string {
  const d = shopHourDisplay(priceGold);
  return t(`shop_page.${d.unit}_count`, { count: d.count });
}

const filteredItems = computed<MarqueeShopItem[]>(() =>
  (items.value ?? []).filter(
    (item) =>
      item.available &&
      !item.coming_soon &&
      item.price_hours > 0 &&
      item.available_in_region !== false,
  ),
);

// shuffle after mount so SSR and hydration both use the unshuffled order
const shuffledItems = ref<MarqueeShopItem[]>([]);

onMounted(() => {
  const list = [...filteredItems.value];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i]!, list[j]!] = [list[j]!, list[i]!];
  }
  shuffledItems.value = list;
});

const displayItems = computed<MarqueeShopItem[]>(() =>
  shuffledItems.value.length > 0 ? shuffledItems.value : filteredItems.value,
);

const loopedItems = computed(() => {
  const list = displayItems.value;
  if (list.length === 0) return [];
  return [...list, ...list];
});
</script>

<template>
  <section
    v-if="displayItems.length > 0"
    class="relative z-10 w-full py-20 sm:py-28"
  >
    <h2 class="font-satoro text-5xl sm:text-6xl text-ds-brown text-center mb-2">
      {{ $t("landing.shop_marquee_title") }}
    </h2>
    <p class="text-ds-brown/60 text-center text-base sm:text-lg font-medium mb-10 px-6">
      {{ $t("landing.shop_marquee_sub") }}
    </p>

    <div class="marquee-viewport">
      <div class="marquee-track">
        <div
          v-for="(item, i) in loopedItems"
          :key="`${item.id}-${i}`"
          class="marquee-card group"
          :aria-hidden="i >= displayItems.length ? 'true' : undefined"
        >
          <div class="marquee-card-image">
            <img
              v-if="item.image_url"
              :src="item.image_url"
              :alt="item.name"
              class="w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            >
            <span v-else class="text-ds-brown/30 text-xs">{{ $t("shop_page.no_image") }}</span>
          </div>
          <div class="flex flex-col gap-1 mt-3 px-1">
            <span class="font-bold text-ds-brown text-sm leading-tight line-clamp-2">{{ item.name }}</span>
            <span class="text-xs text-ds-brown/70 font-bold">
              ~{{ shopTimeLabel(item.price_gold) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-center mt-10 px-6">
      <NuxtLink
        to="/shop"
        class="ds-btn-primary inline-flex items-center gap-2 text-base"
      >
        {{ $t("landing.shop_marquee_cta") }}
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.marquee-viewport {
  overflow: hidden;
  position: relative;
  width: 100%;
  mask-image: linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%);
}

.marquee-track {
  display: flex;
  gap: 1.25rem;
  width: max-content;
  padding: 0.5rem 0;
  animation: marquee-scroll 100s linear infinite;
}

.marquee-track:hover {
  animation-play-state: paused;
}

.marquee-card {
  display: flex;
  flex-direction: column;
  background: rgba(246, 229, 200, 0.8);
  border: 3px solid rgba(104, 77, 58, 0.25);
  padding: 0.75rem;
  min-width: 160px;
  max-width: 160px;
  text-decoration: none;
  color: inherit;
  flex-shrink: 0;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.marquee-card:hover {
  border-color: rgba(104, 77, 58, 0.6);
  transform: translateY(-2px);
}

.marquee-card-image {
  aspect-ratio: 4 / 3;
  background: #ecd2ae;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

@media (min-width: 768px) {
  .marquee-card {
    min-width: 220px;
    max-width: 220px;
    padding: 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .marquee-track {
    animation: none;
    overflow-x: auto;
    max-width: 100vw;
  }
  .marquee-viewport {
    overflow-x: auto;
    mask-image: none;
    -webkit-mask-image: none;
  }
}
</style>
