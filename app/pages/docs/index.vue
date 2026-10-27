<script setup lang="ts">
import * as icons from "lucide-vue-next";
import { docSections, getSection } from "~/utils/docSections";

const { locale, t } = useI18n();

useSeoMeta({
  title: () => t("seo.docs.indexTitle"),
  description: () => t("seo.docs.indexDescription"),
  ogTitle: () => t("seo.docs.indexTitle"),
  ogDescription: () => t("seo.docs.indexDescription"),
  ogType: "website",
  twitterCard: "summary_large_image",
});

if (import.meta.server) {
  defineOgImage("Macondo", {
    title: "Documentation",
    description: "Guides for shipping hardware and software in Macondo.",
    kind: "doc",
  });
}

useHead({
  link: [
    { rel: "alternate", hreflang: "en", href: "/docs" },
    { rel: "alternate", hreflang: "es", href: "/docs" },
    { rel: "alternate", hreflang: "x-default", href: "/docs" },
  ],
});

const collection = computed(() => (locale.value === "es" ? "docs_es" : "docs_en"));
const sourcePath = computed(() => (locale.value === "es" ? "/docs/es" : "/docs/en"));
const localePrefix = computed(() => (locale.value === "es" ? "/docs/es" : "/docs/en"));

const { data: page } = await useAsyncData(
  () => `docs-index-${locale.value}`,
  () =>
    (collection.value === "docs_es"
      ? queryCollection("docs_es").path(sourcePath.value).first()
      : queryCollection("docs_en").path(sourcePath.value).first()),
  { watch: [locale] },
);

const { data: rawDocs } = await useAsyncData(
  () => `docs-landing-${locale.value}`,
  () => {
    return collection.value === "docs_es"
      ? queryCollection("docs_es").select("path", "title", "description", "section", "order", "icon").all()
      : queryCollection("docs_en").select("path", "title", "description", "section", "order", "icon").all();
  },
  { watch: [locale] },
);

function toPublic(path: string): string {
  const prefix = localePrefix.value;
  if (path === prefix) return "/docs";
  if (path.startsWith(`${prefix}/`)) return `/docs/${path.slice(prefix.length + 1)}`;
  return path;
}

interface LandingEntry {
  publicPath: string;
  title: string;
  description?: string;
  icon?: string;
  section: string;
  order: number;
}

const entriesBySection = computed<Map<string, LandingEntry[]>>(() => {
  const map = new Map<string, LandingEntry[]>();
  for (const raw of (rawDocs.value ?? []) as Array<Record<string, unknown>>) {
    const publicPath = toPublic(String(raw.path ?? ""));
    if (publicPath === "/docs") continue;
    const section = raw.section ? String(raw.section) : "misc";
    const entry: LandingEntry = {
      publicPath,
      title: String(raw.title ?? ""),
      description: raw.description ? String(raw.description) : undefined,
      icon: raw.icon ? String(raw.icon) : undefined,
      section,
      order: typeof raw.order === "number" ? raw.order : 99, // docs without an order sort last
    };
    if (!entry.title) continue;
    if (!map.has(section)) map.set(section, []);
    map.get(section)!.push(entry);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
});

function firstInSection(key: string): LandingEntry | null {
  const list = entriesBySection.value.get(key);
  return list && list.length > 0 ? list[0]! : null;
}

const softwareEntry = computed(() => firstInSection("software"));
const hardwareEntry = computed(() => firstInSection("hardware"));

const heroPaths = computed(() => {
  const softwareSection = getSection("software");
  const hardwareSection = getSection("hardware");
  return [
    {
      to: hardwareEntry.value?.publicPath ?? "/docs/hardware-setup",
      title: t("docs.paths.hardware_title"),
      description: t("docs.paths.hardware_desc"),
      icon: hardwareSection.icon,
      accent: hardwareSection.accentHex,
      image: "/images/orpheus/orpheus_solding.webp",
    },
    {
      to: softwareEntry.value?.publicPath ?? "/docs/environment",
      title: t("docs.paths.software_title"),
      description: t("docs.paths.software_desc"),
      icon: softwareSection.icon,
      accent: softwareSection.accentHex,
      image: "/images/orpheus/orpheus_coding.webp",
    },
  ];
});

const otherSections = computed(() => {
  const excluded = new Set(["software", "hardware", "misc"]);
  return docSections
    .filter((s) => !excluded.has(s.key))
    .map((section) => {
      const first = firstInSection(section.key);
      if (!first) return null;
      return {
        to: first.publicPath,
        title: t(section.labelKey),
        description: first.description ?? first.title,
        icon: section.icon,
        accent: section.accentHex,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
});

function iconComponent(name: string | undefined) {
  if (!name) return null;
  return (icons as Record<string, unknown>)[
    name
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("")
  ] ?? null;
}
</script>

<template>
  <div>
    <div class="prose prose-sm prose-brown max-w-none">
      <ContentRenderer v-if="page" :value="page" />
      <div v-else class="text-center py-12 not-prose">
        <h1 class="text-2xl font-bold text-ds-brown mb-2">{{ t("docs.page_not_found") }}</h1>
        <p class="text-sm text-ds-brown/60">{{ t("docs.page_not_found_body") }}</p>
      </div>
    </div>

    <section v-if="otherSections.length" class="not-prose mt-10">
      <h2 class="text-xs uppercase tracking-widest font-bold text-ds-brown/60 mb-3">
        {{ t("docs.paths.explore_more") }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <NuxtLink
          v-for="entry in otherSections"
          :key="entry.to"
          :to="entry.to"
          class="group flex items-start gap-3 p-4 bg-parchment border-[3px] border-ds-brown/20 no-underline transition-colors"
          :style="{ borderLeftColor: entry.accent, borderLeftWidth: '5px' }"
        >
          <component :is="iconComponent(entry.icon)" v-if="iconComponent(entry.icon)" :size="20" :color="entry.accent" class="shrink-0 mt-1" />
          <div class="flex-1 min-w-0">
            <div class="font-bold text-ds-brown text-base leading-tight">
              {{ entry.title }}
            </div>
            <p class="mt-1 text-xs text-ds-brown/70 leading-relaxed m-0 line-clamp-2">
              {{ entry.description }}
            </p>
          </div>
          <span class="text-ds-brown/30 group-hover:text-ds-brown transition-all group-hover:translate-x-1">&rarr;</span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
a.group:hover {
  background: rgb(246 229 199 / 0.7);
  border-color: rgb(104 77 58 / 0.5);
}
</style>
