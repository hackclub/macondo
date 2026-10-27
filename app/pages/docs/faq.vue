<script setup lang="ts">
const { locale } = useI18n();

interface FaqItem {
  id: number;
  question: string;
  answer: string;
}

const { data } = await useAsyncData(
  () => `docs-faq-${locale.value}`,
  () =>
    $fetch<{ items: FaqItem[] }>("/api/faq", {
      query: { locale: locale.value === "es" ? "es" : "en" },
    }),
  { watch: [locale] },
);

const items = computed<FaqItem[]>(() => data.value?.items ?? []);

const docTitle = computed(() =>
  locale.value === "es" ? "Preguntas Frecuentes" : "FAQ",
);
const docDescription = computed(() =>
  locale.value === "es"
    ? "Preguntas frecuentes sobre Macondo."
    : "Frequently asked questions.",
);

useSeoMeta({
  title: () => docTitle.value,
  description: () => docDescription.value,
  ogTitle: () => docTitle.value,
  ogDescription: () => docDescription.value,
  ogType: "article",
  twitterCard: "summary_large_image",
});

if (import.meta.server) {
  defineOgImage("Macondo", {
    title: docTitle.value,
    description: docDescription.value,
    kind: "doc",
  });
}

useSchemaOrg([
  defineArticle({
    headline: () => docTitle.value,
    description: () => docDescription.value,
    inLanguage: () => locale.value,
  }),
]);

useHead({
  link: [
    { rel: "alternate", hreflang: "en", href: "/docs/faq" },
    { rel: "alternate", hreflang: "es", href: "/docs/faq" },
    { rel: "alternate", hreflang: "x-default", href: "/docs/faq" },
  ],
});

const docAccent = inject<Ref<string>>("docAccent", ref("#684D3A"));

useDocsHighlight(".prose-brown", () => "/docs/faq");
</script>

<template>
  <div>
    <details class="xl:hidden mb-6 border-l-4 bg-ds-brown/5 p-3 doc-toc-mobile" :style="{ borderColor: docAccent }">
      <summary class="cursor-pointer font-bold text-sm text-ds-brown uppercase tracking-wide select-none">
        {{ $t("docs.on_this_page") }}
      </summary>
      <div class="mt-3">
        <DocToc :accent="docAccent" />
      </div>
    </details>

    <div class="prose prose-sm prose-brown max-w-none">
      <h1>{{ docTitle }}</h1>

      <div class="not-prose divide-y divide-ds-brown/15">
        <div
          v-for="item in items"
          :id="`faq-${item.id}`"
          :key="item.id"
          class="py-4 first:pt-0 last:pb-0 scroll-mt-20"
        >
          <p class="font-bold text-ds-brown text-[0.95rem] leading-snug m-0">{{ item.question }}</p>
          <p class="text-ds-brown/90 text-[0.9rem] leading-relaxed mt-1.5 mb-0">{{ item.answer }}</p>
        </div>
      </div>

      <div v-if="items.length === 0" class="not-prose text-center py-12">
        <p class="text-sm text-ds-brown/60">{{ $t("docs.page_not_found_body") }}</p>
      </div>
    </div>
  </div>
</template>
