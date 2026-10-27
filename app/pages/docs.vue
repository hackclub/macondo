<script setup lang="ts">
import * as icons from "lucide-vue-next";
import { ArrowLeft } from "lucide-vue-next";
import { docSections } from "~/utils/docSections";
import DocsSearch from "~/components/DocsSearch.vue";
import DocsSearchButton from "~/components/DocsSearchButton.vue";
import { useDocsSearch } from "~/composables/useDocsSearch";

definePageMeta({ layout: false });

const route = useRoute();
const { locale, t } = useI18n();

const { enabled: musicEnabled } = useMusicPlayer();

const { toggle: toggleDocsSearch, openSearch: openDocsSearch, open: docsSearchOpen, prewarm: prewarmDocsSearch } = useDocsSearch(
  (locale.value === "es" ? "es" : "en") as "en" | "es",
);

// prewarm so the first Cmd+K press has no spinner; runs once per locale.
if (import.meta.client) {
  onMounted(() => {
    prewarmDocsSearch();
  });
  watch(
    () => locale.value,
    () => prewarmDocsSearch(),
  );
}

interface DocPageMeta {
  path: string;
  title: string;
  publicPath: string;
  section?: string;
  order?: number;
  icon?: string;
  group?: string;
  groupTitle?: string;
  groupOrder?: number;
}

const { data: rawDocs } = await useAsyncData(
  () => `docs-nav-${locale.value}`,
  () => {
    return queryCollection(locale.value === "es" ? "docs_es" : "docs_en")
      .select("path", "title", "section", "order", "icon", "group", "groupTitle", "groupOrder")
      .all();
  },
  { watch: [locale] },
);

const localePrefix = computed(() => (locale.value === "es" ? "/docs/es" : "/docs/en"));

function toPublic(path: string): string {
  const prefix = localePrefix.value;
  if (path === prefix) return "/docs";
  if (path.startsWith(`${prefix}/`)) return `/docs/${path.slice(prefix.length + 1)}`;
  return path;
}

const docs = computed<DocPageMeta[]>(() => {
  return ((rawDocs.value ?? []) as Array<Record<string, unknown>>)
    .map((d) => ({
      path: String(d.path ?? ""),
      title: String(d.title ?? ""),
      publicPath: toPublic(String(d.path ?? "")),
      section: d.section ? String(d.section) : undefined,
      order: typeof d.order === "number" ? d.order : undefined,
      icon: d.icon ? String(d.icon) : undefined,
      group: d.group ? String(d.group) : undefined,
      groupTitle: d.groupTitle ? String(d.groupTitle) : undefined,
      groupOrder: typeof d.groupOrder === "number" ? d.groupOrder : undefined,
    }))
    .filter((d) => d.title);
});

interface NavItem extends DocPageMeta {
  depth: 0 | 1;
}

interface NavSection {
  key: string;
  label: string;
  accent: string;
  accentHex: string;
  icon: string;
  order: number;
  items: NavItem[];
  total: number;
}

const navSections = computed<NavSection[]>(() => {
  const bySection = new Map<string, DocPageMeta[]>();
  for (const doc of docs.value) {
    const sectionKey = doc.section ?? "misc";
    if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
    bySection.get(sectionKey)!.push(doc);
  }

  const result: NavSection[] = [];
  for (const section of docSections) {
    const sectionDocs = bySection.get(section.key);
    if (!sectionDocs || sectionDocs.length === 0) continue;

    const byGroup = new Map<string, DocPageMeta[]>();
    const ungrouped: DocPageMeta[] = [];
    for (const doc of sectionDocs) {
      if (doc.group) {
        if (!byGroup.has(doc.group)) byGroup.set(doc.group, []);
        byGroup.get(doc.group)!.push(doc);
      } else {
        ungrouped.push(doc);
      }
    }
    ungrouped.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

    const items: NavItem[] = ungrouped.map((d) => ({ ...d, depth: 0 }));

    const groupEntries = Array.from(byGroup.entries()).map(([groupKey, groupDocs]) => {
      groupDocs.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      const groupTitle = groupDocs[0]?.groupTitle ?? groupKey;
      const groupOrder = groupDocs[0]?.groupOrder ?? 99;
      const groupHead = groupDocs.find((d) => d.publicPath.endsWith(`/${groupKey}`) || d.order === 0) ?? groupDocs[0]!;
      return { head: { ...groupHead, title: groupTitle }, rest: groupDocs.filter((d) => d !== groupHead), groupOrder };
    });
    groupEntries.sort((a, b) => a.groupOrder - b.groupOrder);
    for (const g of groupEntries) {
      items.push({ ...g.head, depth: 0 });
      for (const child of g.rest) items.push({ ...child, depth: 1 });
    }

    result.push({
      key: section.key,
      label: t(section.labelKey),
      accent: section.accent,
      accentHex: section.accentHex,
      icon: section.icon,
      order: section.order,
      items,
      total: items.length,
    });
  }
  return result;
});

const currentSection = computed<NavSection | undefined>(() => {
  for (const section of navSections.value) {
    if (section.items.some((i) => i.publicPath === route.path)) return section;
  }
  return undefined;
});

const currentSectionKey = computed<string | null>(() => currentSection.value?.key ?? null);

const currentAccent = computed(() => currentSection.value?.accentHex ?? "#684D3A");

const mobileNavOpen = ref(false);

function isActive(path: string) {
  return route.path === path;
}

function navigate(to: string) {
  mobileNavOpen.value = false;
  navigateTo(to);
}

const flatPages = computed(() => {
  const flat: Array<{ publicPath: string; title: string }> = [];
  for (const section of navSections.value) {
    for (const item of section.items) {
      flat.push({ publicPath: item.publicPath, title: item.title });
    }
  }
  return flat;
});

const currentIndex = computed(() => flatPages.value.findIndex((p) => p.publicPath === route.path));
const prevPage = computed(() => (currentIndex.value > 0 ? flatPages.value[currentIndex.value - 1] : null));
const nextPage = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < flatPages.value.length - 1
    ? flatPages.value[currentIndex.value + 1]
    : null,
);

const contentKey = computed(() => route.path);

watch(
  () => route.path,
  () => {
    if (import.meta.client) window.scrollTo({ top: 0, behavior: "instant" });
  },
);

function iconComponent(name: string | undefined) {
  if (!name) return null;
  const pascal = name
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return (icons as Record<string, unknown>)[pascal] ?? null;
}

provide("docAccent", currentAccent);
provide("docSection", currentSection);

const DASHBOARD_HREF = "/dashboard?from=fade";
const transitioningToDashboard = ref(false);

async function goToDashboard(event?: Event) {
  event?.preventDefault();
  mobileNavOpen.value = false;
  transitioningToDashboard.value = true;
  // one tick flushes the v-if so the overlay paints before the hand-off.
  await nextTick();
  await navigateTo(DASHBOARD_HREF);
}

if (import.meta.client) {
  onMounted(() => {
    if (document.querySelector(`link[rel="prefetch"][data-dashboard-warm]`)) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = DASHBOARD_HREF;
    link.setAttribute("data-dashboard-warm", "");
    document.head.appendChild(link);
  });
}

const DOCS_INTRO_KEY = "docs:intro:dismissed";
const showIntro = ref(false);

if (import.meta.client) {
  onMounted(() => {
    try {
      if (localStorage.getItem(DOCS_INTRO_KEY) !== "true") {
        showIntro.value = true;
      }
    } catch {
      // localStorage unavailable (private mode, etc.), skip the intro silently
    }
  });
}

function dismissIntro() {
  try {
    localStorage.setItem(DOCS_INTRO_KEY, "true");
  } catch {
    // ignore
  }
  showIntro.value = false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function handleDocsKeydown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "k") {
    e.preventDefault();
    toggleDocsSearch();
    return;
  }
  if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (docsSearchOpen.value) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    openDocsSearch();
  }
}

if (import.meta.client) {
  onMounted(() => {
    window.addEventListener("keydown", handleDocsKeydown);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleDocsKeydown);
  });
}
</script>

<template>
  <div class="min-h-screen bg-parchment" :style="{ '--doc-accent': currentAccent }">
    <div class="fixed top-4 left-4 z-30 lg:hidden flex items-center gap-2">
      <button
        class="bg-parchment border-[3px] border-ds-brown p-2 shadow-md"
        :aria-label="t('docs_nav.open_menu')"
        @click="mobileNavOpen = true"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <DocsSearchButton variant="icon" />
    </div>

    <Transition name="fade-overlay">
      <div v-if="mobileNavOpen" class="fixed inset-0 z-40 bg-black/30 lg:hidden" @click="mobileNavOpen = false" />
    </Transition>

    <aside
      class="fixed top-0 left-0 z-50 h-screen w-[19rem] p-3 transition-transform duration-200 lg:hidden"
      :class="mobileNavOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <DocsNav
        :sections="navSections"
        :current-section-key="currentSectionKey"
        :is-active="isActive"
        :icon-component="iconComponent"
        @navigate="navigate"
      >
        <template #back>
          <!-- plain <a>: SPA nav to /dashboard overflows the render stack via its async page imports -->
          <a
            :href="DASHBOARD_HREF"
            class="back-to-farm group flex items-center gap-2 w-full px-3 py-2.5 border-[3px] border-ds-brown bg-ds-brown text-ds-cream font-bold text-sm no-underline cursor-pointer transition-all hover:bg-ds-brown/90"
            @click="goToDashboard"
          >
            <ArrowLeft :size="16" :stroke-width="2.5" class="shrink-0 transition-transform group-hover:-translate-x-0.5" />
            <span class="flex-1 leading-none">{{ t("docs_nav.back_to_farm") }}</span>
          </a>
        </template>
        <template #search>
          <DocsSearchButton />
        </template>
      </DocsNav>
    </aside>

    <!-- capped height leaves room for the music player in the bottom-left corner -->
    <aside
        class="fixed top-0 left-0 z-10 hidden lg:flex w-[18rem] py-6 pl-6 pr-3"
        :class="musicEnabled ? 'h-[calc(100vh_-_16rem)]' : 'h-screen'"
    >
      <DocsNav
        :sections="navSections"
        :current-section-key="currentSectionKey"
        :is-active="isActive"
        :icon-component="iconComponent"
        @navigate="navigate"
      >
        <template #back>
          <a
            :href="DASHBOARD_HREF"
            class="back-to-farm group flex items-center gap-2 w-full px-3 py-2.5 border-[3px] border-ds-brown bg-ds-brown text-ds-cream font-bold text-sm no-underline cursor-pointer transition-all hover:bg-ds-brown/90"
            @click="goToDashboard"
          >
            <ArrowLeft :size="16" :stroke-width="2.5" class="shrink-0 transition-transform group-hover:-translate-x-0.5" />
            <span class="flex-1 leading-none">{{ t("docs_nav.back_to_farm") }}</span>
          </a>
        </template>
        <template #search>
          <DocsSearchButton />
        </template>
      </DocsNav>
    </aside>

    <!-- covers the reload into the dashboard so it reads as one transition, not a white flash -->
    <Transition name="fade-black">
      <div v-if="transitioningToDashboard" class="fixed inset-0 z-[200] bg-black pointer-events-none" />
    </Transition>

    <div class="lg:ml-[18rem] xl:mr-[18rem]">
      <main class="max-w-3xl px-6 py-8 pt-16 lg:pt-8 lg:ml-12">
        <Transition name="docs-fade" mode="out-in">
          <div :key="contentKey">
            <div v-if="currentSection" class="mb-6 flex items-center gap-2 text-xs uppercase tracking-widest font-bold" :style="{ color: currentSection.accentHex }">
              <component :is="iconComponent(currentSection.icon)" v-if="iconComponent(currentSection.icon)" :size="14" />
              <span>{{ currentSection.label }}</span>
            </div>

            <NuxtPage />

            <div
              v-if="prevPage || nextPage"
              class="flex items-stretch gap-3 mt-12 pt-6 border-t-2 border-ds-brown/15"
            >
              <NuxtLink
                v-if="prevPage"
                :to="prevPage.publicPath"
                class="flex-1 flex items-center gap-2 px-4 py-3 text-sm font-semibold text-ds-brown border-[3px] hover:bg-ds-brown/10 transition-colors no-underline"
                :style="{ borderColor: currentAccent }"
              >
                <span class="text-lg leading-none">&larr;</span>
                <span class="truncate">{{ prevPage.title }}</span>
              </NuxtLink>
              <div v-else class="flex-1" />
              <NuxtLink
                v-if="nextPage"
                :to="nextPage.publicPath"
                class="flex-1 flex items-center justify-end gap-2 px-4 py-3 text-sm font-semibold text-ds-brown border-[3px] hover:bg-ds-brown/10 transition-colors no-underline"
                :style="{ borderColor: currentAccent }"
              >
                <span class="truncate">{{ nextPage.title }}</span>
                <span class="text-lg leading-none">&rarr;</span>
              </NuxtLink>
              <div v-else class="flex-1" />
            </div>
          </div>
        </Transition>
      </main>
    </div>

    <aside class="fixed top-0 right-0 hidden xl:block h-screen w-[18rem] p-6 overflow-hidden">
      <DocToc :accent="currentAccent" />
    </aside>

    <DocsIntroModal :open="showIntro" @close="dismissIntro" />
    <DocsSearch />

    <HelpWidget />
  </div>
</template>

<style scoped>
.docs-fade-enter-active {
  transition: opacity 0.2s ease;
}
.docs-fade-leave-active {
  transition: opacity 0.1s ease;
}
.docs-fade-enter-from {
  opacity: 0;
}
.docs-fade-leave-to {
  opacity: 0;
}

.fade-overlay-enter-active,
.fade-overlay-leave-active {
  transition: opacity 0.2s ease;
}
.fade-overlay-enter-from,
.fade-overlay-leave-to {
  opacity: 0;
}

/* no fade-in: cut to black instantly so the navigation starts on the next frame */
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
