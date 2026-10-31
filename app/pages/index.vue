<script setup lang="ts">
import { Plus, ArrowRight } from "lucide-vue-next";

const { signIn, isLoggedIn, loading, user } = useAuth();
const { t } = useI18n();
const route = useRoute();

useSeoMeta({
  title: () => t("seo.landing.title"),
  description: () => t("seo.landing.description"),
  ogTitle: () => t("seo.landing.ogTitle"),
  ogDescription: () => t("seo.landing.description"),
  ogType: "website",
  twitterCard: "summary_large_image",
});


const loginRequired = computed(() => route.query.login === "required");

type LandingProject = {
  image: string;
  name: string;
  descriptionKey: string;
  creditKey: string;
  href?: string;
  imageFit?: "contain";
  accent?: string;
  overlayLogo?: string;
};

const PROJECTS: LandingProject[] = [
  {
    image: "/images/landing/projects/doompdf.webp",
    name: "DoomPDF",
    descriptionKey: "landing.projects.doompdf_desc",
    creditKey: "landing.projects.doompdf_credit",
    href: "https://github.com/ading2210/doompdf",
  },
  {
    image: "/images/landing/projects/librepods-logo.webp",
    name: "LibrePods",
    imageFit: "contain",
    descriptionKey: "landing.projects.librepods_desc",
    creditKey: "landing.projects.librepods_credit",
    href: "https://github.com/kavishdevar/librepods",
  },
  {
    image: "/images/landing/projects/vert.webp",
    name: "Vert",
    descriptionKey: "landing.projects.vert_desc",
    creditKey: "landing.projects.vert_credit",
    href: "https://github.com/VERT-sh/VERT",
  },
  {
    image: "/images/landing/projects/bam.webp",
    name: "The Biblically Accurate Macropad",
    descriptionKey: "landing.projects.bam_desc",
    creditKey: "landing.projects.bam_credit",
    href: "https://github.com/geg-tech/biblicallyaccuratekeyboard",
  },
  {
    image: "/images/landing/projects/specter.webp",
    overlayLogo: "/images/landing/projects/specter-logo.webp",
    name: "Specter",
    accent: "#0a0e1a",
    descriptionKey: "landing.projects.specter_desc",
    creditKey: "landing.projects.specter_credit",
    href: "https://github.com/ayessaaa/specter",
  },
  {
    image: "/images/landing/projects/blinddefusal.webp",
    name: "Blind Defusal",
    descriptionKey: "landing.projects.blinddefusal_desc",
    creditKey: "landing.projects.blinddefusal_credit",
    href: "https://github.com/Jayx2u/blind-defusal",
  },
  {
    image: "/images/landing/projects/cyberboardv2.webp",
    name: "Cyberboard V2",
    descriptionKey: "landing.projects.cyberboardv2_desc",
    creditKey: "landing.projects.cyberboardv2_credit",
    href: "https://github.com/NotARoomba/Cyberboard",
  },
  {
    image: "/images/landing/projects/killersplit.webp",
    name: "KillerSplit",
    descriptionKey: "landing.projects.killersplit_desc",
    creditKey: "landing.projects.killersplit_credit",
    href: "https://github.com/MrKillerShaunBa/KillerSplit",
  },
  {
    image: "/images/landing/projects/cyberpad.webp",
    name: "CyberPad",
    descriptionKey: "landing.projects.cyberpad_desc",
    creditKey: "landing.projects.cyberpad_credit",
    href: "https://github.com/KaiPereira/CYBERPAD-01",
  },
  {
    image: "/images/landing/projects/glowpad.webp",
    name: "GlowPad",
    descriptionKey: "landing.projects.glowpad_desc",
    creditKey: "landing.projects.glowpad_credit",
    href: "https://github.com/lordbagel42/glowpad",
  },
  {
    image: "/images/landing/projects/meko.webp",
    name: "Meko",
    descriptionKey: "landing.projects.meko_desc",
    creditKey: "landing.projects.meko_credit",
    href: "https://github.com/KOEGlike/meko",
  },
  {
    image: "/images/landing/projects/bitlace.webp",
    name: "Bitlace",
    descriptionKey: "landing.projects.bitlace_desc",
    creditKey: "landing.projects.bitlace_credit",
    href: "https://github.com/glutesha/bitlace",
  },
  {
    image: "/images/landing/projects/3dpmotherboard.webp",
    name: "3DP Motherboard",
    descriptionKey: "landing.projects.motherboard_desc",
    creditKey: "landing.projects.motherboard_credit",
    href: "https://github.com/KaiPereira/Cheetah-MX4-Mini",
  },
  {
    image: "/images/landing/projects/twoswap.webp",
    name: "TwoSwap",
    descriptionKey: "landing.projects.twoswap_desc",
    creditKey: "landing.projects.twoswap_credit",
  },
  {
    image: "/images/landing/projects/picat.webp",
    name: "PiCat",
    descriptionKey: "landing.projects.picat_desc",
    creditKey: "landing.projects.picat_credit",
    href: "https://github.com/sbunger/PICAT",
  },
];

type EventCard = { image: string; avif: string; labelKey: string; href: string };
const eventCards: EventCard[] = [
  { image: "/images/landing/parthenon.webp", avif: "/images/landing/parthenon.avif", labelKey: "landing.event_parthenon", href: "https://www.youtube.com/watch?v=7K_E7tG-O68" },
  { image: "/images/landing/shipwrecked.webp", avif: "/images/landing/shipwrecked.avif", labelKey: "landing.event_shipwrecked", href: "https://shipwrecked.hackclub.com/" },
  { image: "/images/landing/undercity.webp", avif: "/images/landing/undercity.avif", labelKey: "landing.event_undercity", href: "https://youtu.be/kaEFv7e49mo" },
];
const cardOrder = ref([0, 1, 2]);

type FaqItem = { qKey: string; aKey: string };
const faqItems: FaqItem[] = [
  { qKey: "landing.faq.q_beginner", aKey: "landing.faq.a_beginner" },
  { qKey: "landing.faq.q_teams", aKey: "landing.faq.a_teams" },
  { qKey: "landing.faq.q_eligible", aKey: "landing.faq.a_eligible" },
  { qKey: "landing.faq.q_cant_come", aKey: "landing.faq.a_cant_come" },
  { qKey: "landing.faq.q_free", aKey: "landing.faq.a_free" },
  { qKey: "landing.faq.q_hackclub", aKey: "landing.faq.a_hackclub" },
  { qKey: "landing.faq.q_bogota", aKey: "landing.faq.a_bogota" },
  { qKey: "landing.faq.q_more", aKey: "landing.faq.a_more" },
];
const openFaq = ref<number | null>(null);
function toggleFaq(i: number) {
  openFaq.value = openFaq.value === i ? null : i;
}

const transitioning = ref(false);
const fromAuth = computed(() => route.query.from === "auth");

// instant cut-to-black; fading out here and in on the dashboard doubled the perceived wait.
async function paintBlackThen(action: () => void) {
  transitioning.value = true;
  // double rAF guarantees the overlay painted before navigation starts.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  action();
}

async function fadeToDashboard() {
  // go straight to /onboarding so the farm doesn't flash before the middleware redirects.
  const step = user.value?.onboarding_step;
  const storyIncomplete = !!step && step !== "complete" && step !== "tutorial";
  const target = storyIncomplete ? "/onboarding" : "/dashboard?from=fade";
  await paintBlackThen(() => { void navigateTo(target); });
}

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

// filled after mount: random SSR values cause hydration mismatches that freeze <Transition>.
// top is in px so fruits stay put when content below grows (e.g. the FAQ).
const scatteredFruits = ref<Array<{
  src: string;
  top: string;
  left: string;
  rotation: number;
  size: number;
  delay: number;
}>>([]);

const cloudScrollProgress = ref(0);
let cloudScrollRaf = 0;
function updateCloudScroll() {
  cloudScrollRaf = 0;
  // finish within half a viewport so the clouds rise while the hero is still in view.
  cloudScrollProgress.value = Math.min(1, Math.max(0, window.scrollY / ((window.innerHeight || 800) * 0.5)));
}
function onCloudScroll() {
  if (cloudScrollRaf) return;
  cloudScrollRaf = requestAnimationFrame(updateCloudScroll);
}
onMounted(() => {
  window.addEventListener("scroll", onCloudScroll, { passive: true });
  updateCloudScroll();
});
onUnmounted(() => {
  window.removeEventListener("scroll", onCloudScroll);
  if (cloudScrollRaf) cancelAnimationFrame(cloudScrollRaf);
});

// Keep the detailed diagram off the smallest screens.
const showDesktopFlow = ref(false);
let flowMedia: MediaQueryList | null = null;
function syncShowDesktopFlow() {
  showDesktopFlow.value = !!flowMedia?.matches;
}
onMounted(() => {
  flowMedia = window.matchMedia("(min-width: 950px)");
  syncShowDesktopFlow();
  flowMedia.addEventListener("change", syncShowDesktopFlow);
});
onUnmounted(() => {
  flowMedia?.removeEventListener("change", syncShowDesktopFlow);
});
const cloudTransform = computed(() => {
  // calc mixes image height with the px rest offset so the image never needs measuring.
  return `translateY(calc(${cloudScrollProgress.value.toFixed(4)} * (-100% + 192px)))`; // 192px is the -bottom-48 rest offset
});
const contentSection = ref<HTMLElement | null>(null);

// the global scatter sits behind the About WoodFrame, so this strip guarantees visible fruit there.
type FruitSprite = {
  src: string;
  left: string;
  top: string;
  rotation: number;
  size: number;
};
const aboutFruitsBelow = ref<FruitSprite[]>([]);

onMounted(() => {
  const count = 6;
  const slotWidthPct = 88 / count; // 88% usable strip width (6% margin each side)
  aboutFruitsBelow.value = Array.from({ length: count }, (_, i) => {
    const size = 36 + Math.random() * 24;
    const slotCenter = 6 + (i + 0.5) * slotWidthPct;
    const jitter = (Math.random() - 0.5) * slotWidthPct * 0.5;
    return {
      src: fruitIcons[Math.floor(Math.random() * fruitIcons.length)]!,
      left: `${(slotCenter + jitter).toFixed(2)}%`,
      top: `${Math.round(Math.random() * (120 - size - 8) + 4)}px`,
      rotation: Math.random() * 360,
      size,
    };
  });
});

onMounted(() => {
  // 10% top margin keeps fruit from crowding the first section after the hero.
  const h = contentSection.value?.offsetHeight ?? window.innerHeight * 5;
  const cols = 5;
  const rows = 8;
  const leftMarginPct = 2;
  const usableWidthPct = 96;
  const topMarginFrac = 0.1;
  const usableHeightFrac = 0.8;
  const jitterAmount = 0.45;

  scatteredFruits.value = Array.from({ length: cols * rows }, (_, i) => {
    const cellCenterX = (i % cols + 0.5) / cols; // 0..1 within grid
    const cellCenterY = (Math.floor(i / cols) + 0.5) / rows;
    const jx = (Math.random() - 0.5) * jitterAmount / cols;
    const jy = (Math.random() - 0.5) * jitterAmount / rows;
    const leftFrac = cellCenterX + jx;
    const topFrac = topMarginFrac + (cellCenterY + jy) * usableHeightFrac;
    return {
      src: fruitIcons[(i * 7) % fruitIcons.length]!, // stride-7 so adjacent cells don't repeat the same icon
      top: `${Math.round(topFrac * h)}px`,
      left: `${(leftMarginPct + leftFrac * usableWidthPct).toFixed(2)}%`,
      rotation: Math.random() * 360,
      size: 36 + Math.random() * 48,
      delay: Math.random() * 2,
    };
  });
});

// prefetch the route the next click will actually hit; re-runs so post-signup changes repoint it.
if (import.meta.client) {
  const ensureNextRoutePrefetch = () => {
    if (!isLoggedIn.value) return;
    const step = user.value?.onboarding_step;
    const storyIncomplete = !!step && step !== "complete" && step !== "tutorial";
    const href = storyIncomplete ? "/onboarding" : "/dashboard?from=fade";
    const existing = document.querySelector<HTMLLinkElement>(`link[rel="prefetch"][data-dashboard-warm]`);
    if (existing) {
      if (existing.href.endsWith(href)) return;
      existing.remove();
    }
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    link.setAttribute("data-dashboard-warm", "");
    document.head.appendChild(link);
  };
  watch(
    [isLoggedIn, () => user.value?.onboarding_step],
    ensureNextRoutePrefetch,
    { immediate: true },
  );
}

let cardInterval: ReturnType<typeof setInterval>;
onMounted(() => {
  cardInterval = setInterval(() => {
    const arr = cardOrder.value;
    cardOrder.value = [arr[1]!, arr[2]!, arr[0]!];
  }, 3000);
});
onUnmounted(() => clearInterval(cardInterval));

const topCardIndex = computed(() => cardOrder.value[cardOrder.value.length - 1]!);

function cycleCards() {
  const arr = cardOrder.value;
  cardOrder.value = [arr[1]!, arr[2]!, arr[0]!];
}

const projectsSection = ref<HTMLElement | null>(null);
const projectsExpanded = ref(false);
const dragIndex = ref(-1);

const visibleProjectCount = ref(PROJECTS.length);
function computeVisibleCount() {
  if (typeof window === 'undefined') return PROJECTS.length;
  const w = window.innerWidth;
  if (w >= 1280) return 15;
  if (w >= 1024) return 12;
  if (w >= 768) return 9;
  if (w >= 640) return 6;
  return 4;
}

const visibleProjects = computed(() => PROJECTS.slice(0, visibleProjectCount.value));

const projectPositions = computed(() => {
  const count = visibleProjectCount.value;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      x: `${50 + (35 + (i % 3) * 5) * Math.cos(angle)}%`,
      y: `${50 + (30 + (i % 2) * 8) * Math.sin(angle)}%`,
      rot: -8 + (i * 5) % 16,
    };
  });
});

// sized to the max count so slots stay stable across resize.
const dragOffsets = reactive(PROJECTS.map(() => ({ x: 0, y: 0 })));
let dragStartX = 0;
let dragStartY = 0;
let dragEl: HTMLElement | null = null;
let dragIdx = -1;

function startDrag(e: PointerEvent, index: number, href?: string) {
  e.preventDefault();
  dragIndex.value = index;
  dragIdx = index;
  dragEl = e.currentTarget as HTMLElement;
  dragEl.setPointerCapture(e.pointerId);
  dragStartX = e.clientX - dragOffsets[index]!.x;
  dragStartY = e.clientY - dragOffsets[index]!.y;

  // a tap with hand tremor still counts as a click (HTML5 DnD default threshold).
  const pointerStartX = e.clientX;
  const pointerStartY = e.clientY;
  let didDrag = false;

  const onMove = (ev: PointerEvent) => {
    if (!dragEl || dragIdx < 0) return;
    if (!didDrag) {
      const dx = ev.clientX - pointerStartX;
      const dy = ev.clientY - pointerStartY;
      if (dx * dx + dy * dy >= 25) didDrag = true;
    }
    dragOffsets[dragIdx]!.x = ev.clientX - dragStartX;
    dragOffsets[dragIdx]!.y = ev.clientY - dragStartY;
  };

  const onUp = () => {
    dragIndex.value = -1;
    dragIdx = -1;
    dragEl = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (!didDrag && href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

onMounted(() => {
  if (!projectsSection.value) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          projectsExpanded.value = true;
          observer.disconnect();
        }
      }
    },
    { threshold: 0.2 },
  );
  observer.observe(projectsSection.value);
});

let projectsResizeHandler: (() => void) | null = null;
onMounted(() => {
  visibleProjectCount.value = computeVisibleCount();
  projectsResizeHandler = () => {
    visibleProjectCount.value = computeVisibleCount();
  };
  window.addEventListener('resize', projectsResizeHandler);
});
onUnmounted(() => {
  if (projectsResizeHandler) window.removeEventListener('resize', projectsResizeHandler);
});

</script>

<template>
  <div class="relative w-full">
    <Transition name="fade-black">
      <div v-if="transitioning" class="fixed inset-0 z-50 bg-black" />
    </Transition>

    <!-- below 959px object-cover crops the baked-in title, so it is rendered as text instead -->
    <section class="relative h-screen w-full overflow-hidden flex items-center justify-center">
      <!-- the house sits ~57% across the artwork, so shift left to center it on phones -->
      <picture class="block h-full w-auto max-w-none min-[959px]:hidden -translate-x-[7%]">
        <source srcset="/images/landing/background.avif" type="image/avif">
        <img
          src="/images/landing/background.webp"
          alt=""
          class="h-full w-auto max-w-none"
          loading="eager"
          decoding="async"
        >
      </picture>
      <picture class="hidden min-[959px]:block h-full w-full">
        <source srcset="/images/landing/background_text.avif" type="image/avif">
        <img
          src="/images/landing/background_text.webp"
          alt=""
          class="h-full w-full object-cover"
          loading="eager"
          decoding="async"
        >
      </picture>

      <!-- above the artwork but below the hero text (z-[16]) and nav (z-20) so both stay usable -->
      <img
        src="/images/landing/clouds_parallax.png"
        alt=""
        class="pointer-events-none absolute top-full left-0 right-0 w-full z-[15] select-none"
        :style="{ transform: cloudTransform, willChange: 'transform' }"
      >

      <h1
        class="min-[959px]:hidden absolute z-10 top-[14%] left-1/2 -translate-x-1/2 font-title text-[27vw] leading-none text-tuscan-sun-400 drop-shadow-lg select-none pointer-events-none macondo-title whitespace-nowrap px-2"
      >
        Macondo
      </h1>

      <nav class="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4">
        <a
          href="https://hackclub.com"
          target="_blank"
          rel="noreferrer noopener"
          class="inline-block"
          aria-label="Hack Club"
        >
          <img
            src="https://assets.hackclub.com/flag-standalone.svg"
            alt="Hack Club"
            class="w-28 sm:w-36 drop-shadow-lg"
          >
        </a>
        <button
          v-if="!isLoggedIn"
          class="px-5 py-2 bg-ds-brown text-ds-cream font-bold text-sm sm:text-base rounded-sm shadow-lg hover:bg-ds-brown/90 transition-colors font-satoro"
          @click="signIn"
        >
          {{ $t("common.sign_in") }}
        </button>
      </nav>

      <div class="absolute inset-0 z-[16] flex flex-col items-center justify-end pb-16 px-6">
        <div v-if="loading && !fromAuth" class="flex justify-center py-6">
          <div class="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>

        <template v-else>

          <div class="flex flex-col items-center gap-3 w-full max-w-lg">
            <p v-if="loginRequired" class="text-sm text-red-400 text-center font-medium drop-shadow">
              {{ $t("auth.login_required") }}
            </p>

            <button
              v-if="isLoggedIn"
              class="group flex w-full items-center justify-center gap-2 shadow-xl border-[3px] border-ds-brown bg-ds-brown text-ds-cream font-bold text-lg sm:text-xl h-12 px-6 hover:bg-ds-brown/90 transition-colors font-satoro"
              @click="fadeToDashboard"
            >
              <span>{{ $t("landing.go_to_dashboard") }}</span>
              <ArrowRight :size="20" :stroke-width="2.5" class="shrink-0 transition-transform group-hover:translate-x-1" />
            </button>
          </div>

          <p class="font-satoro text-ds-brown text-xl sm:text-2xl font-bold mt-3 text-center bg-ds-cream px-6 py-2">
            {{ $t("landing.tagline") }}
          </p>

          <p class="font-satoro text-ds-brown/70 text-sm mt-10 animate-bounce">
            {{ $t("landing.scroll_hint") }}
          </p>
        </template>
      </div>
    </section>

    <div ref="contentSection" class="relative w-full bg-parchment overflow-x-clip">
      <div class="absolute inset-0 pointer-events-none z-0">
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

      <section id="about" class="relative z-10 w-full py-16 sm:py-24">
        <div class="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16">
          <WoodFrame class="w-full" :no-bg="true">
            <div class="bg-ds-brown text-parchment p-8 sm:p-12 md:p-16 flex flex-col md:flex-row gap-10 items-center" style="margin: -8px -12px -16px -8px;">
              <div class="flex-1">
                <p class="text-3xl sm:text-4xl text-ds-cream mb-1 font-extrabold">{{ $t("landing.what_is_prefix") }}</p>
                <h2 class="font-title text-5xl sm:text-7xl text-tuscan-sun-400 mb-6">Macondo?</h2>

                <p class="text-base sm:text-lg font-extrabold leading-relaxed mb-4">
                  {{ $t("landing.description_p1") }}
                  <span class="bg-ds-success/60 px-1">{{ $t("landing.description_p1_highlight") }}</span>
                </p>

                <p class="text-base sm:text-lg font-extrabold leading-relaxed">
                  {{ $t("landing.description_p3") }}
                  <span class="bg-ds-success/60 px-1">{{ $t("landing.description_p3_highlight") }}</span>
                </p>

                <NuxtLink
                  to="/event"
                  class="ds-btn-primary-inverted mt-6 inline-block px-6 py-3 text-base"
                >
                  {{ $t("landing.learn_more_event") }}
                </NuxtLink>
              </div>

              <div class="w-full md:w-[400px] shrink-0 flex flex-col items-center">
                <div
                  class="relative w-full aspect-[4/3] cursor-pointer overflow-hidden border-[3px] border-parchment shadow-lg"
                  @click="cycleCards"
                >
                  <!-- the first background-image is the fallback for browsers without image-set() -->
                  <div
                    v-for="(card, idx) in eventCards"
                    :key="idx"
                    class="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
                    :class="topCardIndex === idx ? 'opacity-100' : 'opacity-0'"
                    :style="`background-image: url(${card.image}); background-image: image-set(url(${card.avif}) type('image/avif'), url(${card.image}) type('image/webp'));`"
                  />
                </div>
                <p class="mt-3">
                  <a
                    :href="eventCards[topCardIndex]!.href"
                    target="_blank"
                    class="text-parchment/60 text-sm md:text-base underline hover:text-parchment/80"
                  >
                    {{ $t(eventCards[topCardIndex]!.labelKey) }}
                  </a>
                </p>
              </div>
            </div>
          </WoodFrame>
        </div>
      </section>

      <div class="relative z-0 w-full h-[120px] pointer-events-none">
        <div
          v-for="(fruit, i) in aboutFruitsBelow"
          :key="'about-fruit-below-' + i"
          class="absolute opacity-60"
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

      <section id="flow" class="relative z-10 w-full py-16 md:py-24">
        <div class="max-w-[1400px] mx-auto md:px-6 md:sm:px-10 lg:px-16">
          <div class="min-[950px]:hidden px-4">
            <h2 class="font-satoro text-2xl text-ds-brown mb-2 text-center">{{ $t("landing.flow.heading") }}</h2>
            <p class="font-satoro text-sm text-ds-brown/80 text-center mb-5 max-w-md mx-auto">{{ $t("landing.flow.subheading") }}</p>
            <div class="flex flex-col items-stretch gap-1.5">
              <div class="bg-parchment border-[3px] border-ds-brown p-3 shadow-md flex items-start gap-2">
                <img src="/images/fruits/avocado/icon_interior.webp" class="w-7 h-7 object-contain shrink-0" alt="">
                <div>
                  <p class="font-satoro font-bold text-ds-brown text-sm">1. {{ $t("landing.flow.node1_title") }}</p>
                  <p class="text-xs text-ds-brown/80 mt-0.5">{{ $t("landing.flow.node1_body") }}</p>
                </div>
              </div>
              <div class="flex justify-center text-ds-brown text-2xl font-bold leading-none">↓</div>
              <div class="bg-parchment border-[3px] border-ds-brown p-3 shadow-md flex items-start gap-2">
                <img src="/images/fruits/papaya/icon_interior.webp" class="w-7 h-7 object-contain shrink-0" alt="">
                <div>
                  <p class="font-satoro font-bold text-ds-brown text-sm">2. {{ $t("landing.flow.node2_title") }}</p>
                  <p class="text-xs text-ds-brown/80 mt-0.5">{{ $t("landing.flow.node2_body") }}</p>
                </div>
              </div>
              <div class="flex justify-center text-ds-brown text-xl font-bold leading-none">↓</div>

              <div class="grid grid-cols-2 gap-2 mt-1 items-stretch">
                <div class="flex flex-col gap-1.5">
                  <div class="font-satoro font-bold text-ds-cream text-[11px] uppercase tracking-widest text-center bg-ds-brown border-[3px] border-ds-brown px-2 py-1 shadow-md">
                    Hardware
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/cocoa/icon_interior.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3a. {{ $t("landing.flow.node3a_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node3a_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/coco/icon_interior.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3b. {{ $t("landing.flow.node4a_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node4a_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/mango/icon.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3c. {{ $t("landing.flow.node5_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node5_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <div class="font-satoro font-bold text-ds-cream text-[11px] uppercase tracking-widest text-center bg-ds-brown border-[3px] border-ds-brown px-2 py-1 shadow-md">
                    Software
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/pineapple/icon.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3a. {{ $t("landing.flow.node_track_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node_track_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/guava/icon_interior.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3b. {{ $t("landing.flow.node3b_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node3b_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                  <div class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md flex items-start gap-1.5">
                    <img src="/images/fruits/watermelon/icon_interior.webp" class="w-6 h-6 object-contain shrink-0" alt="">
                    <div>
                      <p class="font-satoro font-bold text-ds-brown text-xs leading-tight">3c. {{ $t("landing.flow.node_earn_title") }}</p>
                      <p class="text-[10px] text-ds-brown/80 mt-0.5 leading-snug">{{ $t("landing.flow.node_earn_body") }}</p>
                    </div>
                  </div>
                  <div class="flex flex-col items-center flex-1 min-h-[30px]">
                    <div class="w-[2px] bg-ds-brown flex-1"></div>
                    <span class="text-ds-brown text-lg font-bold leading-none -mt-1">↓</span>
                  </div>
                </div>
              </div>

              <div class="relative">
                <div class="bg-parchment border-[3px] border-ds-brown p-3 shadow-md flex items-start gap-2">
                  <img src="/images/fruits/avocado/icon_interior.webp" class="w-7 h-7 object-contain shrink-0" alt="">
                  <div>
                    <p class="font-satoro font-bold text-ds-brown text-sm">4. {{ $t("landing.flow.node4b_title") }}</p>
                    <p class="text-xs text-ds-brown/80 mt-0.5">{{ $t("landing.flow.node4b_body") }}</p>
                  </div>
                </div>
                <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 100" preserveAspectRatio="none" style="overflow: visible; z-index: 10;" aria-hidden="true">
                  <path d="M 12 50 C 15 10, 80 -6, 150 -4 C 222 -4, 292 10, 289 52 C 292 92, 222 105, 150 103 C 78 105, 10 92, 16 48" stroke="#F2BF40" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.5" />
                </svg>
              </div>

            </div>
          </div>

          <div class="hidden min-[950px]:block w-full overflow-visible">
            <h2 class="font-satoro text-5xl sm:text-6xl text-ds-brown mb-3 text-center">{{ $t("landing.flow.heading") }}</h2>
            <p class="font-satoro text-lg sm:text-xl text-ds-brown/80 text-center mb-8 max-w-2xl mx-auto">{{ $t("landing.flow.subheading") }}</p>

            <ClientOnly>
              <div v-if="showDesktopFlow" class="overflow-visible">
                <LazyMacondoFlowChart />
              </div>
              <div v-else style="height: 1100px;" />
              <template #fallback>
                <div style="height: 1100px;" />
              </template>
            </ClientOnly>
          </div>
        </div>
      </section>

      <ShopItemsMarquee />

      <section ref="projectsSection" class="relative z-10 w-full py-24 sm:py-32">
        <h2 class="font-satoro text-5xl sm:text-6xl text-ds-brown text-center mb-2">{{ $t("landing.projects_heading") }}</h2>
        <p class="text-ds-brown/60 text-center text-base sm:text-lg font-medium mb-16">{{ $t("landing.projects_sub") }}</p>
        <div class="relative max-w-[1400px] mx-auto px-6" style="height: 1100px;">
          <div
            v-for="(project, i) in visibleProjects"
            :key="'proj-' + i"
            class="project-card absolute border-[3px] border-ds-brown bg-parchment text-ds-brown font-bold p-2 flex flex-col shadow-lg cursor-grab active:cursor-grabbing w-48 sm:w-56 select-none"
            :style="{
              left: projectPositions[i]?.x ?? '50%',
              top: projectPositions[i]?.y ?? '50%',
              transform: `translate(calc(-50% + ${dragOffsets[i]!.x}px), calc(-50% + ${dragOffsets[i]!.y}px)) rotate(${projectPositions[i]?.rot ?? 0}deg) ${projectsExpanded ? '' : 'scale(0.8)'}`,
              opacity: projectsExpanded ? 1 : 0,
              transition: dragIndex === i
                ? 'none'
                : `transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.7s ease ${i * 0.06}s`,
              zIndex: dragIndex === i ? 50 : 10 + i,
            }"
            :aria-label="project.href ? `${project.name}, open on GitHub` : project.name"
            :role="project.href ? 'link' : undefined"
            @pointerdown="(e: PointerEvent) => startDrag(e, i, project.href)"
          >
            <div
              class="relative w-full border-2 border-parchment pointer-events-none"
              :class="project.imageFit === 'contain' ? 'bg-white p-3' : ''"
              :style="project.accent ? { backgroundColor: project.accent } : {}"
            >
              <img
                :src="project.image"
                :alt="project.name"
                :class="project.imageFit === 'contain' ? 'w-full aspect-[4/3] object-contain' : 'w-full aspect-[4/3] object-cover'"
              >
              <img v-if="project.overlayLogo" :src="project.overlayLogo" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-12 object-contain" :alt="project.name">
            </div>
            <span v-if="project.name" class="text-xs font-bold text-ds-brown mt-1.5 pointer-events-none text-center w-full block">{{ project.name }}</span>
            <p class="py-1 text-[10px] sm:text-xs pointer-events-none font-normal text-center">{{ $t(project.descriptionKey) }}</p>
            <p class="mt-auto text-center text-[10px] font-light pointer-events-none">{{ $t(project.creditKey) }}</p>
          </div>
        </div>
      </section>

      <section id="faq" class="relative z-10 w-full px-12 sm:px-20 lg:px-40 xl:px-56 py-16">
        <div class="max-w-7xl mx-auto">
          <h2 class="font-satoro text-5xl sm:text-6xl text-ds-brown mb-10">{{ $t("landing.faq_title") }}</h2>

          <div class="divide-y divide-ds-brown/30 border-y border-ds-brown/30">
            <div v-for="(item, i) in faqItems" :key="i">
              <button
                class="w-full flex justify-between items-center py-5 text-left text-lg sm:text-xl font-medium text-ds-brown gap-4"
                @click="toggleFaq(i)"
              >
                <span>{{ $t(item.qKey) }}</span>
                <Plus
                  :size="20"
                  class="shrink-0 text-ds-brown/60 transition-transform duration-300"
                  :class="openFaq === i ? 'rotate-45' : ''"
                />
              </button>
              <div
                class="overflow-hidden transition-all duration-300 ease-in-out"
                :style="{ maxHeight: openFaq === i ? '400px' : '0px' }"
              >
                <div class="pb-5 text-base text-ds-brown/70 leading-relaxed">
                  {{ $t(item.aKey) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="relative z-10 w-full px-12 sm:px-20 lg:px-40 xl:px-56 py-12 sm:py-16 text-ds-brown">
        <div class="max-w-7xl mx-auto">
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
                <a class="block hover:opacity-80 transition-opacity" href="#about">{{ $t("landing.footer_full.m_about") }}</a>
                <a class="block hover:opacity-80 transition-opacity" href="#flow">{{ $t("landing.footer_full.m_how") }}</a>
                <a class="block hover:opacity-80 transition-opacity" href="#faq">{{ $t("landing.footer_full.m_faq") }}</a>
                <NuxtLink class="block hover:opacity-80 transition-opacity" to="/docs">{{ $t("landing.footer_full.m_docs") }}</NuxtLink>
                <NuxtLink class="block hover:opacity-80 transition-opacity" to="/certificate">{{ $t("certificate.landing.footer_link") }}</NuxtLink>
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

      <img
        :src="'/images/landing/clouds.webp'"
        alt=""
        class="relative z-10 w-full block"
      >
    </div>
  </div>
</template>

<style scoped>
/* outline so the mobile title reads against the sky */
.macondo-title {
  -webkit-text-stroke: 1.5px #684D3A;
  paint-order: stroke fill;
}

/* no enter fade: cut to black so navigation can start next frame */
.fade-black-enter-active {
  transition: none;
}
.fade-black-leave-active {
  transition: opacity 0.4s ease;
}
.fade-black-leave-to {
  opacity: 0;
}

</style>
