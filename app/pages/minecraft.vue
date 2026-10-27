<script setup lang="ts">
import { macondoHasEnded } from "~~/shared/macondo-end";
import { ArrowRight, Check } from "lucide-vue-next";

// "Get Free Minecraft" is honest: the Forge MDK installs a working Minecraft client in the dev environment.

const { t, locale } = useI18n();

useSeoMeta({
  title: () => t("seo.minecraft.title"),
  description: () => t("seo.minecraft.description"),
  keywords: () => t("seo.minecraft.keywords"),
  ogTitle: () => t("seo.minecraft.ogTitle"),
  ogDescription: () => t("seo.minecraft.description"),
  ogType: "article",
  twitterCard: "summary_large_image",
});

// SSR only: client-side setup crashes (nuxt-modules/og-image#293).
if (import.meta.server) {
  defineOgImage("Macondo", {
    title: t("seo.minecraft.ogTitle"),
    description: t("seo.minecraft.description"),
    kind: "doc",
  });
}

useSchemaOrg([
  defineArticle({
    headline: () => t("seo.minecraft.ogTitle"),
    description: () => t("seo.minecraft.description"),
    inLanguage: () => locale.value,
  }),
]);

useHead({
  link: [
    { rel: "alternate", hreflang: "en", href: "/minecraft" },
    { rel: "alternate", hreflang: "es", href: "/minecraft" },
    { rel: "alternate", hreflang: "x-default", href: "/minecraft" },
  ],
});

const ctaPending = ref(false);

async function onCtaClick() {
  if (ctaPending.value) return;
  ctaPending.value = true;
  // fire-and-forget; keepalive lets the request survive navigating away.
  try {
    if (!macondoHasEnded()) fetch("/api/analytics/landing-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        landing: "minecraft",
        target: "/",
        locale: locale.value,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let an analytics failure block the user.
  }
  await navigateTo("/");
}

// generated on mount so SSR and first client render match; Math.random() because
// a stride-7 picker over 14 icons only yields 2 distinct fruits.
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

type FruitSprite = {
  src: string;
  top: string;
  left: string;
  rotation: number;
  size: number;
};

const scatteredFruits = ref<FruitSprite[]>([]);

onMounted(() => {
  const cols = 5;
  const rows = 8;
  const leftMarginPct = 2;
  const usableWidthPct = 96;
  const topMarginFrac = 0.04;
  const usableHeightFrac = 0.92;
  const jitterAmount = 0.45;

  scatteredFruits.value = Array.from({ length: cols * rows }, (_, i) => {
    const cellCenterX = (i % cols + 0.5) / cols;
    const cellCenterY = (Math.floor(i / cols) + 0.5) / rows;
    const jx = ((Math.random() - 0.5) * jitterAmount) / cols;
    const jy = ((Math.random() - 0.5) * jitterAmount) / rows;
    const leftFrac = cellCenterX + jx;
    const topFrac = topMarginFrac + (cellCenterY + jy) * usableHeightFrac;
    return {
      src: fruitIcons[Math.floor(Math.random() * fruitIcons.length)]!,
      top: `${(topFrac * 100).toFixed(2)}%`,
      left: `${(leftMarginPct + leftFrac * usableWidthPct).toFixed(2)}%`,
      rotation: Math.random() * 360,
      size: 32 + Math.random() * 36,
    };
  });
});
</script>

<template>
  <div class="relative w-full bg-parchment min-h-screen overflow-x-clip">
    <div class="absolute inset-0 pointer-events-none z-0">
      <div
        v-for="(fruit, i) in scatteredFruits"
        :key="'fruit-' + i"
        class="absolute opacity-30"
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

    <header class="relative z-10 max-w-[1100px] mx-auto px-6 sm:px-10 pt-6 sm:pt-10 flex items-center justify-between text-ds-brown">
      <NuxtLink to="/" class="hover:opacity-80 transition-opacity">
        <img
          src="/logo_macondo.png"
          alt="Macondo"
          class="h-8 sm:h-10 w-auto"
          draggable="false"
        >
      </NuxtLink>
      <a
        href="https://hackclub.com?utm_source=macondo"
        target="_blank"
        rel="noreferrer"
        class="text-sm sm:text-base font-bold hover:opacity-80 transition-opacity inline-flex items-center gap-2"
      >
        {{ $t("landing.footer_full.project_by_prefix") }}
        <span class="text-[#ec3750] underline">Hack Club</span>
      </a>
    </header>

    <section class="relative z-10 max-w-[1100px] mx-auto px-6 sm:px-10 pt-10 sm:pt-16 pb-8 text-ds-brown">
      <div class="flex flex-col-reverse md:flex-row items-center gap-8 md:gap-12">
        <div class="flex-1">
          <h1 class="text-3xl sm:text-5xl md:text-6xl font-extrabold leading-tight mb-4 text-ds-brown">
            {{ $t("minecraft.heading") }}
          </h1>
          <p class="text-base sm:text-lg md:text-xl font-bold mb-5 leading-relaxed">
            {{ $t("minecraft.tagline") }}
          </p>

          <button
            type="button"
            :disabled="ctaPending"
            class="group inline-flex items-center justify-center gap-2 shadow-xl border-[3px] border-ds-brown bg-ds-brown text-ds-cream font-bold text-lg sm:text-xl h-14 px-8 hover:bg-ds-brown/90 transition-colors disabled:opacity-70"
            @click="onCtaClick"
          >
            {{ $t("minecraft.cta") }}
            <ArrowRight class="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div class="shrink-0 w-40 sm:w-56 md:w-64">
          <img
            src="/images/orpheus/orpheus_thinking_excited.webp"
            alt="Orpheus, the Hack Club mascot"
            class="w-full h-auto object-contain drop-shadow-lg"
            draggable="false"
          >
        </div>
      </div>
    </section>

    <section class="relative z-10 max-w-[1100px] mx-auto px-6 sm:px-10 pb-16 text-ds-brown">
      <ul class="space-y-3 mb-10">
        <li class="flex items-start gap-3 text-base sm:text-lg">
          <Check class="w-6 h-6 mt-0.5 shrink-0 text-ds-brown" :stroke-width="3" />
          <span class="font-bold">{{ $t("minecraft.bullets.tools") }}</span>
        </li>
        <li class="flex items-start gap-3 text-base sm:text-lg">
          <Check class="w-6 h-6 mt-0.5 shrink-0 text-ds-brown" :stroke-width="3" />
          <span class="font-bold">{{ $t("minecraft.bullets.guide") }}</span>
        </li>
        <li class="flex items-start gap-3 text-base sm:text-lg">
          <Check class="w-6 h-6 mt-0.5 shrink-0 text-ds-brown" :stroke-width="3" />
          <span class="font-bold">{{ $t("minecraft.bullets.yours") }}</span>
        </li>
      </ul>

      <div class="space-y-5 text-sm sm:text-base leading-relaxed text-ds-brown/90 max-w-3xl">
        <p>{{ $t("minecraft.launcherProse") }}</p>
        <p>{{ $t("minecraft.modpackProse") }}</p>
      </div>
    </section>

    <!-- same i18n keys as the index page so the attribution copy stays in sync -->
    <footer class="relative z-10 max-w-[1100px] mx-auto w-full px-6 sm:px-10 py-12 sm:py-16 text-ds-brown">
      <div>
        <p class="mb-4 text-lg md:text-xl font-bold">
          {{ $t("landing.footer_full.project_by_prefix") }}
          <a
            href="https://hackclub.com?utm_source=macondo"
            target="_blank"
            rel="noreferrer"
            class="underline hover:opacity-80 transition-opacity text-[#ec3750] text-xl md:text-2xl"
          >Hack Club</a>
        </p>

        <p class="max-w-3xl text-ds-brown/75 text-sm md:text-base mb-8 leading-relaxed">
          {{ $t("landing.footer_full.description_p1") }}<a
            href="https://summer.hackclub.com/"
            target="_blank"
            rel="noreferrer"
            class="underline hover:opacity-80 transition-opacity"
          >{{ $t("landing.footer_full.link_som") }}</a>{{ $t("landing.footer_full.description_p2") }}<a
            href="https://github.com/hackclub/the-hacker-zephyr"
            target="_blank"
            rel="noreferrer"
            class="underline hover:opacity-80 transition-opacity"
          >{{ $t("landing.footer_full.link_zephyr") }}</a>{{ $t("landing.footer_full.description_p3") }}<a
            href="https://www.youtube.com/watch?v=QvCoISXfcE8"
            target="_blank"
            rel="noreferrer"
            class="underline hover:opacity-80 transition-opacity"
          >{{ $t("landing.footer_full.link_canada") }}</a>.
          <br><br>
          {{ $t("landing.footer_full.shipping_tagline") }}
        </p>

        <div class="flex flex-wrap gap-x-16 gap-y-8">
          <div class="flex flex-col">
            <p class="mb-3 text-base md:text-lg font-bold text-yellow-600">
              {{ $t("landing.footer_full.col_macondo") }}
            </p>
            <div class="text-sm md:text-base space-y-1">
              <NuxtLink class="block hover:opacity-80 transition-opacity" to="/">{{ $t("landing.footer_full.m_about") }}</NuxtLink>
              <NuxtLink class="block hover:opacity-80 transition-opacity" to="/docs">{{ $t("landing.footer_full.m_docs") }}</NuxtLink>
              <NuxtLink class="block hover:opacity-80 transition-opacity" to="/docs/minecraft-modding">{{ $t("minecraft.footerLink") }}</NuxtLink>
            </div>
          </div>

          <div class="flex flex-col">
            <p class="mb-3 text-base md:text-lg font-bold text-blue-grey-600">
              {{ $t("landing.footer_full.col_resources") }}
            </p>
            <div class="text-sm md:text-base space-y-1">
              <a class="block hover:opacity-80 transition-opacity" href="https://slack.hackclub.com" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.r_slack") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://events.hackclub.com/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.r_events") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://workshops.hackclub.com/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.r_workshops") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://hackclub.com/conduct/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.r_conduct") }}</a>
            </div>
          </div>

          <div class="flex flex-col">
            <p class="mb-3 text-base md:text-lg font-bold text-[#ec3750]">
              {{ $t("landing.footer_full.col_hackclub") }}
            </p>
            <div class="text-sm md:text-base space-y-1">
              <a class="block hover:opacity-80 transition-opacity" href="https://hackclub.com/philosophy/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.hc_philosophy") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://hackclub.com/team/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.hc_team") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://hackclub.com/brand/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.hc_branding") }}</a>
              <a class="block hover:opacity-80 transition-opacity" href="https://hackclub.com/philanthropy/" target="_blank" rel="noreferrer">{{ $t("landing.footer_full.hc_donate") }}</a>
            </div>
          </div>
        </div>

        <p class="mt-12 text-ds-brown/60 text-sm">
          {{ $t("landing.footer_full.made_with_love") }}
        </p>
      </div>
    </footer>
  </div>
</template>
