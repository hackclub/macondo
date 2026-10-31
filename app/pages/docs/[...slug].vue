<script setup lang="ts">
import { archivePage } from "~~/shared/docs-archive";
const route = useRoute();
const { locale } = useI18n();

const rawSlug = route.params.slug;
const slugParts = Array.isArray(rawSlug) ? rawSlug : rawSlug ? [rawSlug] : [];

// Public URLs are locale-free (/docs/{slug}); content lives at /docs/{locale}/{slug}.
const localizedPath = computed(() => {
  const base = locale.value === "es" ? "/docs/es" : "/docs/en";
  return slugParts.length ? `${base}/${slugParts.join("/")}` : base;
});

const cacheKey = computed(
  () => `docs-${locale.value}-${slugParts.join("-") || "index"}`,
);

const { data: page } = await useAsyncData(
  () => cacheKey.value,
  () =>
    archivePage(locale.value, localizedPath.value),
  { watch: [locale] },
);

const publicPath = computed(() => `/docs${slugParts.length ? `/${slugParts.join("/")}` : ""}`);
const docTitle = computed(() => page.value?.title ?? "Macondo Docs");
const docDescription = computed(
  () => page.value?.description ?? "Documentation for the Macondo program.",
);
const docKeywords = computed(() => page.value?.keywords ?? "");

useSeoMeta({
  title: () => docTitle.value,
  description: () => docDescription.value,
  keywords: () => docKeywords.value,
  ogTitle: () => docTitle.value,
  ogDescription: () => docDescription.value,
  ogType: "article",
  twitterCard: "summary_large_image",
});

useSchemaOrg([
  defineArticle({
    headline: () => docTitle.value,
    description: () => docDescription.value,
    inLanguage: () => locale.value,
  }),
]);

useHead({
  link: [
    { rel: "alternate", hreflang: "en", href: publicPath.value },
    { rel: "alternate", hreflang: "es", href: publicPath.value },
    { rel: "alternate", hreflang: "x-default", href: publicPath.value },
  ],
});

onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    },
    { threshold: 0.25 },
  );

  const container = document.querySelector(".prose-brown");
  if (!container) return;

  const observeVideos = () => {
    container.querySelectorAll("video").forEach((video) => {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      observer.observe(video);
    });
  };

  observeVideos();

  const mutationObserver = new MutationObserver(observeVideos);
  mutationObserver.observe(container, { childList: true, subtree: true });

  onUnmounted(() => {
    observer.disconnect();
    mutationObserver.disconnect();
  });
});

const docAccent = inject<Ref<string>>("docAccent", ref("#684D3A"));

useDocsHighlight(".prose-brown", () => publicPath.value);
</script>

<template>
  <div>
    <HardwareGuideJournalBanner v-if="page?.requiresJournal" />

    <details v-if="page" class="xl:hidden mb-6 border-l-4 bg-ds-brown/5 p-3 doc-toc-mobile" :style="{ borderColor: docAccent }">
      <summary class="cursor-pointer font-bold text-sm text-ds-brown uppercase tracking-wide select-none">
        {{ $t("docs.on_this_page") }}
      </summary>
      <div class="mt-3">
        <DocToc :accent="docAccent" />
      </div>
    </details>

    <div class="prose prose-sm prose-brown max-w-none">
      <MDCRenderer v-if="page" :body="page.body" :data="page" />
      <div v-else class="text-center py-12 not-prose">
        <h1 class="text-2xl font-bold text-ds-brown mb-2">{{ $t("docs.page_not_found") }}</h1>
        <p class="text-sm text-ds-brown/60">{{ $t("docs.page_not_found_body") }}</p>
        <NuxtLink to="/docs" class="text-sm text-ds-brown underline hover:opacity-70 mt-4 inline-block">
          &larr; {{ $t("docs.back_to_docs") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
