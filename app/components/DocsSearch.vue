<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from "vue";
import { Search, X, Loader2, CornerDownLeft, ArrowUp, ArrowDown } from "lucide-vue-next";
import * as icons from "lucide-vue-next";
import type { Component } from "vue";
import WoodFrame from "./WoodFrame.vue";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useDocsSearch, type DocsSearchHit } from "~/composables/useDocsSearch";
import { docSections, getSection } from "~/utils/docSections";

const { locale, t } = useI18n();

const search = useDocsSearch(locale.value as "en" | "es");
const {
  open, query, selectedIndex, recentSearches, isLoading, results, suggestions,
  close, selectNext, selectPrev, selectFirst, selectLast,
  recordRecent, clearRecent, openSearch,
} = search;

// The composable reuses a pre-built index when switching back, so no double rebuild.
watch(
  () => locale.value,
  (l) => {
    useDocsSearch(l === "es" ? "es" : "en");
  },
);

useEscapeClose(open, close);

const inputRef = ref<HTMLInputElement | null>(null);
const listboxRef = ref<HTMLElement | null>(null);

// The server dedupes too; this throttle avoids requests while results flicker empty.
const reportedMisses = new Set<string>();
let missDebounce: ReturnType<typeof setTimeout> | null = null;

function reportMissIfSettled(): void {
  if (missDebounce) clearTimeout(missDebounce);
  missDebounce = setTimeout(() => {
    const q = query.value.trim();
    if (q.length < 3) return; // ignore queries too short to count as misses
    if (results.value.length > 0) return;
    if (isLoading.value) return;
    const key = `${locale.value}:${q.toLowerCase()}`;
    if (reportedMisses.has(key)) return;
    reportedMisses.add(key);
    $fetch("/api/docs/search-miss", {
      method: "POST",
      body: { query: q, locale: locale.value === "es" ? "es" : "en" },
    }).catch(() => {
      // Best-effort telemetry; never surface failures.
    });
  }, 600); // wait for typing to settle before logging a miss
}

watch([query, results, isLoading], () => {
  if (!open.value) return;
  reportMissIfSettled();
});

watch(open, (isOpen) => {
  if (isOpen) {
    nextTick(() => inputRef.value?.focus());
  }
});

// Two-way ?q= sync: a shared URL opens the search pre-filled, and typing mirrors back via replace.
const router = useRouter();
const route = useRoute();

function applyQueryFromUrl(): void {
  const raw = route.query.q;
  if (typeof raw !== "string" || raw.trim().length === 0) return;
  if (raw === query.value) return;
  query.value = raw;
  if (!open.value) openSearch();
}

watch(
  () => route.query.q,
  () => applyQueryFromUrl(),
);

if (import.meta.client) {
  onMounted(() => applyQueryFromUrl());
}

let urlSyncDebounce: ReturnType<typeof setTimeout> | null = null;
watch(query, (q) => {
  if (!open.value) return;
  if (urlSyncDebounce) clearTimeout(urlSyncDebounce);
  urlSyncDebounce = setTimeout(() => {
    if (!open.value) return;
    const trimmed = q.trim();
    const nextQ = trimmed.length > 0 ? trimmed : undefined;
    if ((typeof route.query.q === "string" ? route.query.q : undefined) === nextQ) return;
    router.replace({ query: { ...route.query, q: nextQ } });
  }, 300); // debounce url sync while typing
});

// Late timers would add ?q= to another page or log telemetry for an abandoned search.
onBeforeUnmount(() => {
  if (missDebounce) { clearTimeout(missDebounce); missDebounce = null; }
  if (urlSyncDebounce) { clearTimeout(urlSyncDebounce); urlSyncDebounce = null; }
});

function applySuggestion(s: string): void {
  query.value = s;
  nextTick(() => inputRef.value?.focus());
}

async function go(hit: DocsSearchHit): Promise<void> {
  recordRecent(query.value);
  if (typeof window !== "undefined") {
    try {
      const payload = JSON.stringify({
        terms: hit.matchedTerms,
        path: hit.publicPath,
        expiresAt: Date.now() + 30_000, // highlight handoff ttl in ms
      });
      // Read by pages/docs/[...slug].vue and docs/faq.vue to highlight matched terms.
      window.sessionStorage.setItem("docs:highlight", payload);
    } catch {
      // sessionStorage unavailable (private mode); skip highlighting.
    }
  }
  const href = hit.publicHref;
  close();
  await nextTick();
  await navigateTo(href);
}

function goRecent(q: string): void {
  query.value = q;
  nextTick(() => inputRef.value?.focus());
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectNext();
    scrollActiveIntoView();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectPrev();
    scrollActiveIntoView();
  } else if (e.key === "Home") {
    e.preventDefault();
    selectFirst();
    scrollActiveIntoView();
  } else if (e.key === "End") {
    e.preventDefault();
    selectLast();
    scrollActiveIntoView();
  } else if (e.key === "Enter") {
    const hit = results.value[selectedIndex.value];
    if (hit) {
      e.preventDefault();
      go(hit);
    }
  } else if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    close();
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    const el = listboxRef.value?.querySelector(`[data-result-idx="${selectedIndex.value}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  });
}

// Groups follow docSections order to match the sidebar.
interface Group {
  key: string;
  label: string;
  iconName: string;
  accentHex: string;
  hits: DocsSearchHit[];
}

const groupedResults = computed<Group[]>(() => {
  const byKey = new Map<string, DocsSearchHit[]>();
  for (const hit of results.value) {
    if (!byKey.has(hit.sectionKey)) byKey.set(hit.sectionKey, []);
    byKey.get(hit.sectionKey)!.push(hit);
  }
  const groups: Group[] = [];
  for (const section of docSections) {
    const hits = byKey.get(section.key);
    if (!hits || hits.length === 0) continue;
    groups.push({
      key: section.key,
      label: t(section.labelKey),
      iconName: section.icon,
      accentHex: section.accentHex,
      hits,
    });
  }
  const knownKeys = new Set(docSections.map((s) => s.key));
  const misc: DocsSearchHit[] = [];
  for (const [k, hits] of byKey) if (!knownKeys.has(k)) misc.push(...hits);
  if (misc.length > 0) {
    groups.push({
      key: "misc",
      label: t("docs_search.group_other"),
      iconName: "folder",
      accentHex: "#684D3A",
      hits: misc,
    });
  }
  return groups;
});

// Flat index so keyboard navigation follows the rendered order across groups.
const hitIndex = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  let i = 0;
  for (const group of groupedResults.value) {
    for (const hit of group.hits) {
      map.set(hit.id, i);
      i++;
    }
  }
  return map;
});

function iconComponent(name: string | undefined): Component | null {
  if (!name) return null;
  const pascal = name
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return ((icons as Record<string, unknown>)[pascal] as Component | undefined) ?? null;
}

interface JumpRow {
  key: string;
  href: string;
  label: string;
  sublabel: string;
  iconName: string;
  accentHex: string;
}

const jumpRows = computed<JumpRow[]>(() => {
  const rows: JumpRow[] = [];
  for (const section of docSections) {
    rows.push({
      key: section.key,
      href: `/docs#${section.key}`,
      label: t(section.labelKey),
      sublabel: t("docs_search.jump_sublabel"),
      iconName: section.icon,
      accentHex: section.accentHex,
    });
  }
  return rows;
});

function goToSectionLanding(key: string): void {
  const match = results.value.find((h) => h.sectionKey === key);
  if (match) {
    close();
    nextTick(() => navigateTo(match.publicHref));
    return;
  }
  const href = getSection(key) ? `/docs` : "/docs";
  close();
  nextTick(() => navigateTo(href));
}

const screenReaderSummary = computed(() => {
  if (!query.value.trim()) return "";
  return t("docs_search.results_count", { count: results.value.length });
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm docs-search-backdrop"
      @click="close"
    />
    <div
      v-if="open"
      class="fixed inset-0 z-[211] flex items-start sm:items-center justify-center pointer-events-none p-3 sm:p-6 pt-[10vh] sm:pt-6 docs-search-modal"
    >
        <WoodFrame class="w-full max-w-2xl pointer-events-auto">
          <div class="flex flex-col bg-parchment min-h-[360px] max-h-[80vh] sm:max-h-[72vh]">
            <div class="flex items-center gap-3 px-4 py-3 border-b-[3px] border-ds-brown/20">
              <Loader2 v-if="isLoading" :size="18" class="text-ds-brown/60 shrink-0 animate-spin" />
              <Search v-else :size="18" class="text-ds-brown/70 shrink-0" />
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                :placeholder="t('docs_search.placeholder')"
                :aria-label="t('docs_search.input_label')"
                class="flex-1 bg-transparent outline-none text-ds-brown placeholder:text-ds-brown/40 text-base sm:text-lg font-semibold"
                role="combobox"
                aria-controls="docs-search-listbox"
                aria-expanded="true"
                :aria-activedescendant="results[selectedIndex] ? `docs-search-option-${selectedIndex}` : undefined"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                @keydown="onInputKeydown"
              >
              <button
                v-if="query"
                type="button"
                class="text-ds-brown/40 hover:text-ds-brown transition-colors"
                :aria-label="t('docs_search.clear_query')"
                @click="query = ''"
              >
                <X :size="16" />
              </button>
              <kbd class="hidden sm:inline-flex items-center px-1.5 py-0.5 border border-ds-brown/30 text-[10px] font-bold text-ds-brown/60 bg-white/50">
                Esc
              </kbd>
            </div>

            <div
              id="docs-search-listbox"
              ref="listboxRef"
              role="listbox"
              class="flex-1 overflow-y-auto docs-search-scroll"
            >
              <template v-if="!query.trim()">
                <div v-if="recentSearches.length > 0" class="px-4 pt-4 pb-3">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-ds-brown/55">
                      {{ t("docs_search.recent") }}
                    </span>
                    <button
                      type="button"
                      class="text-[10px] font-semibold uppercase tracking-wider text-ds-brown/45 hover:text-ds-brown transition-colors"
                      @click="clearRecent"
                    >
                      {{ t("docs_search.clear_recent") }}
                    </button>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="r in recentSearches"
                      :key="r"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 border-[2px] border-ds-brown/20 bg-white/60 text-sm text-ds-brown hover:border-ds-brown/50 hover:-translate-y-[1px] transition-all"
                      @click="goRecent(r)"
                    >
                      <Search :size="12" class="text-ds-brown/45" />
                      <span>{{ r }}</span>
                    </button>
                  </div>
                </div>

                <div class="px-4 pt-3 pb-4">
                  <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ds-brown/55 mb-2">
                    {{ t("docs_search.jump_to") }}
                  </div>
                  <ul class="flex flex-col gap-1 list-none m-0 p-0">
                    <li v-for="row in jumpRows" :key="row.key">
                      <button
                        type="button"
                        class="group w-full flex items-center gap-3 px-2.5 py-2 border-[2px] border-ds-brown/10 bg-white/40 hover:bg-ds-brown/8 hover:border-ds-brown/40 hover:translate-x-0.5 transition-all text-left"
                        :style="{ borderLeftColor: row.accentHex, borderLeftWidth: '3px' }"
                        @click="goToSectionLanding(row.key)"
                      >
                        <component :is="iconComponent(row.iconName)" v-if="iconComponent(row.iconName)" :size="16" :color="row.accentHex" class="shrink-0" />
                        <span class="flex-1 text-sm font-semibold text-ds-brown truncate">{{ row.label }}</span>
                        <CornerDownLeft :size="12" class="text-ds-brown/30 group-hover:text-ds-brown/70 transition-colors shrink-0" />
                      </button>
                    </li>
                  </ul>
                </div>
              </template>

              <template v-else-if="results.length === 0 && !isLoading">
                <div class="px-6 py-10 text-center">
                  <div class="text-sm font-semibold text-ds-brown mb-1">
                    {{ t("docs_search.no_results", { query: query.trim() }) }}
                  </div>
                  <div class="text-xs text-ds-brown/60 mb-4">
                    {{ t("docs_search.no_results_hint") }}
                  </div>
                  <div v-if="suggestions.length > 0" class="mb-5">
                    <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ds-brown/55 mb-2">
                      {{ t("docs_search.did_you_mean") }}
                    </div>
                    <div class="flex flex-wrap justify-center gap-1.5">
                      <button
                        v-for="s in suggestions"
                        :key="s"
                        type="button"
                        class="inline-flex items-center gap-1.5 px-2.5 py-1 border-[2px] border-ds-brown/40 bg-ds-brown/5 text-sm font-semibold text-ds-brown hover:bg-ds-brown/15 hover:border-ds-brown transition-colors"
                        @click="applySuggestion(s)"
                      >
                        <Search :size="11" class="text-ds-brown/55" />
                        {{ s }}
                      </button>
                    </div>
                  </div>
                  <div class="flex flex-wrap justify-center gap-1.5">
                    <button
                      v-for="section in docSections"
                      :key="section.key"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 border-[2px] border-ds-brown/20 bg-white/60 text-xs text-ds-brown hover:border-ds-brown/50 transition-colors"
                      :style="{ borderLeftColor: section.accentHex, borderLeftWidth: '3px' }"
                      @click="goToSectionLanding(section.key)"
                    >
                      <component :is="iconComponent(section.icon)" v-if="iconComponent(section.icon)" :size="12" :color="section.accentHex" />
                      {{ t(section.labelKey) }}
                    </button>
                  </div>
                </div>
              </template>

              <template v-else>
                <div
                  v-for="group in groupedResults"
                  :key="group.key"
                  class="pt-3 pb-1"
                >
                  <div class="flex items-center gap-2 px-4 mb-2">
                    <component :is="iconComponent(group.iconName)" v-if="iconComponent(group.iconName)" :size="12" :color="group.accentHex" />
                    <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-ds-brown/60">
                      {{ group.label }}
                    </span>
                    <div class="h-px flex-1 bg-ds-brown/10" />
                    <span class="text-[10px] text-ds-brown/40 tabular-nums">{{ group.hits.length }}</span>
                  </div>
                  <ul class="flex flex-col list-none m-0 p-0">
                    <li
                      v-for="hit in group.hits"
                      :key="hit.id"
                    >
                      <button
                        :id="`docs-search-option-${hitIndex.get(hit.id)}`"
                        type="button"
                        :data-result-idx="hitIndex.get(hit.id)"
                        role="option"
                        :aria-selected="selectedIndex === hitIndex.get(hit.id)"
                        class="group w-full flex items-start gap-3 px-4 py-2.5 text-left border-l-[3px] transition-colors"
                        :class="selectedIndex === hitIndex.get(hit.id)
                          ? 'bg-ds-brown/10'
                          : 'border-transparent hover:bg-ds-brown/5'"
                        :style="selectedIndex === hitIndex.get(hit.id) ? { borderLeftColor: group.accentHex } : undefined"
                        @click="go(hit)"
                        @mouseenter="selectedIndex = hitIndex.get(hit.id) ?? 0"
                      >
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-1.5 text-[11px] text-ds-brown/55 mb-0.5">
                            <span class="truncate">{{ hit.pageTitle }}</span>
                            <template v-for="(tt, idx) in hit.titles" :key="idx">
                              <span class="text-ds-brown/30">›</span>
                              <span class="truncate">{{ tt }}</span>
                            </template>
                          </div>
                          <div class="text-sm font-bold text-ds-brown truncate">
                            {{ hit.anchor ? hit.title : hit.pageTitle }}
                          </div>
                          <div
                            v-if="hit.snippet"
                            class="mt-0.5 text-xs text-ds-brown/70 line-clamp-2 docs-search-snippet"
                            v-html="hit.snippet"
                          />
                        </div>
                        <CornerDownLeft
                          v-if="selectedIndex === hitIndex.get(hit.id)"
                          :size="14"
                          class="text-ds-brown/60 shrink-0 mt-1"
                        />
                      </button>
                    </li>
                  </ul>
                </div>
              </template>
            </div>

            <div class="flex items-center justify-between px-4 py-2 border-t-[3px] border-ds-brown/20 text-[10px] text-ds-brown/60 bg-white/30">
              <div class="flex items-center gap-3">
                <span class="inline-flex items-center gap-1">
                  <kbd class="inline-flex items-center justify-center w-5 h-5 border border-ds-brown/30 bg-white/70">
                    <ArrowUp :size="10" />
                  </kbd>
                  <kbd class="inline-flex items-center justify-center w-5 h-5 border border-ds-brown/30 bg-white/70">
                    <ArrowDown :size="10" />
                  </kbd>
                  <span class="uppercase tracking-wider">{{ t("docs_search.kbd_navigate") }}</span>
                </span>
                <span class="inline-flex items-center gap-1">
                  <kbd class="inline-flex items-center justify-center px-1 h-5 border border-ds-brown/30 bg-white/70 text-[9px] font-bold">
                    <CornerDownLeft :size="10" />
                  </kbd>
                  <span class="uppercase tracking-wider">{{ t("docs_search.kbd_open") }}</span>
                </span>
              </div>
              <div v-if="query.trim()" aria-live="polite" class="tabular-nums">
                {{ t("docs_search.n_results", { count: results.length }) }}
              </div>
              <div v-else class="text-ds-brown/40 hidden sm:block">
                {{ t("docs_search.footer_tip") }}
              </div>
            </div>
          </div>
        </WoodFrame>
      </div>
    <div class="sr-only" aria-live="polite">{{ screenReaderSummary }}</div>
  </Teleport>
</template>

<style scoped>
.docs-search-backdrop {
  animation: docs-search-fade-in 0.2s ease-out;
}
.docs-search-modal {
  animation: docs-search-pop-in 0.2s ease-out;
}

@keyframes docs-search-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes docs-search-pop-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.docs-search-scroll::-webkit-scrollbar { width: 6px; }
.docs-search-scroll::-webkit-scrollbar-thumb { background: rgb(104 77 58 / 0.3); }
.docs-search-scroll::-webkit-scrollbar-track { background: transparent; }

/* Snippet <mark>s come from v-html, so they're styled in the unscoped block below. */
@media (prefers-reduced-motion: reduce) {
  .docs-search-backdrop,
  .docs-search-modal {
    animation: none;
  }
}
</style>

<style>
.docs-search-snippet .docs-search-mark {
  background: rgb(254 215 120 / 0.6);
  color: #684D3A;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
}
</style>
