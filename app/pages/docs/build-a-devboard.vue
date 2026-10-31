<script setup lang="ts">
import MarkdownIt from "markdown-it";
import HTMLSanitizer from "~/utils/sanitize";
import { ExternalLink } from "lucide-vue-next";

interface GuideResponse {
  markdown: string;
  sourceHash: string;
  locale: "en" | "es";
  canonical: string;
  author: { name: string; url: string };
  fetchedAt: number;
}

const KAI_CANONICAL = "https://kaipereira.com/journal/build-a-devboard";
const KAI_AUTHOR_NAME = "Kai Pereira";
const KAI_GITHUB_URL = "https://github.com/KaiPereira";

const { locale, t } = useI18n();

const { data, error } = await useAsyncData(
  () => `docs-build-a-devboard-${locale.value}`,
  () =>
    $fetch<GuideResponse>("/api/external-guides/build-a-devboard", {
      query: { locale: locale.value === "es" ? "es" : "en" },
    }),
  { watch: [locale] },
);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

md.core.ruler.after("linkify", "normalize_links", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children) continue;
    for (const child of token.children) {
      if (child.type === "link_open") {
        const href = child.attrGet("href");
        if (
          href
          && !/^https?:\/\//i.test(href)
          && !/^mailto:/i.test(href)
          && !/^#/.test(href)
        ) {
          child.attrSet("href", "https://" + href);
        }
      }
    }
  }
});

const sanitizedHtml = computed(() => {
  const markdown = data.value?.markdown ?? "";
  if (!markdown) return "";
  return HTMLSanitizer.sanitize(md.render(markdown), {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "pre", "code", "a", "img", "blockquote", "hr",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  });
});

const isSpanish = computed(() => locale.value === "es");

// The credit line goes right under the title, mirroring `usb-hub/index.md`.
const creditPrefix = computed(() => (isSpanish.value ? "Creado por" : "Made by"));
const translatedNotice = computed(() => t("docs.external_guide.auto_translated"));

const finalHtml = computed(() => {
  let html = sanitizedHtml.value.replace(
    /<a /g,
    '<a target="_blank" rel="noopener noreferrer" ',
  );
  const creditHtml
    = `<p class="guide-credit">${creditPrefix.value} `
    + `<a href="${KAI_GITHUB_URL}" target="_blank" rel="noopener noreferrer">@KaiPereira</a>`
    + (isSpanish.value
      ? ` <span class="translated-notice">· ${translatedNotice.value}</span>`
      : "")
    + "</p>";
  // Prepend when the source has no <h1> so attribution still renders.
  if (html.includes("</h1>")) {
    html = html.replace("</h1>", `</h1>${creditHtml}`);
  } else {
    html = creditHtml + html;
  }
  return html;
});

const docTitle = computed(() =>
  isSpanish.value
    ? "Construye una placa de desarrollo"
    : "Build a Devboard",
);
const docDescription = computed(() =>
  isSpanish.value
    ? `Diseña, traza y pide tu propia placa de desarrollo basada en RP2040, por ${KAI_AUTHOR_NAME}.`
    : `Design, lay out, and order your own RP2040-based dev board, by ${KAI_AUTHOR_NAME}.`,
);

useSeoMeta({
  title: () => docTitle.value,
  description: () => docDescription.value,
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
    author: { name: KAI_AUTHOR_NAME, url: "https://kaipereira.com" },
  }),
]);

useHead({
  link: [
    { rel: "canonical", href: KAI_CANONICAL },
    { rel: "alternate", hreflang: "en", href: "/docs/build-a-devboard" },
    { rel: "alternate", hreflang: "es", href: "/docs/build-a-devboard" },
    { rel: "alternate", hreflang: "x-default", href: "/docs/build-a-devboard" },
  ],
});

const docAccent = inject<Ref<string>>("docAccent", ref("#684D3A"));

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
</script>

<template>
  <div>
    <HardwareGuideJournalBanner />

    <details class="xl:hidden mb-6 border-l-4 bg-ds-brown/5 p-3 doc-toc-mobile" :style="{ borderColor: docAccent }">
      <summary class="cursor-pointer font-bold text-sm text-ds-brown uppercase tracking-wide select-none">
        {{ $t("docs.on_this_page") }}
      </summary>
      <div class="mt-3">
        <DocToc :accent="docAccent" />
      </div>
    </details>

    <div v-if="error" class="not-prose text-center py-8 border-[3px] border-ds-brown/20 bg-parchment">
      <h2 class="text-xl font-bold text-ds-brown mb-2">
        {{ $t("docs.external_guide.fetch_failed_title") }}
      </h2>
      <p class="text-sm text-ds-brown/70 mb-4 px-4">
        {{ $t("docs.external_guide.fetch_failed_body") }}
      </p>
      <a
        :href="KAI_CANONICAL"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 px-4 py-2 bg-ds-brown text-ds-cream font-bold text-sm border-[3px] border-ds-brown no-underline hover:opacity-90"
      >
        {{ $t("docs.external_guide.read_canonical", { site: "kaipereira.com" }) }}
        <ExternalLink :size="14" />
      </a>
    </div>

    <article v-else class="prose prose-sm prose-brown max-w-none guide-content" v-html="finalHtml" />
  </div>
</template>

<style scoped>
.guide-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 1em 0;
}

.guide-content :deep(pre) {
  background: rgba(104, 77, 58, 0.08);
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.85em;
}

.guide-content :deep(code) {
  background: rgba(104, 77, 58, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}

.guide-content :deep(pre code) {
  background: none;
  padding: 0;
}
</style>
