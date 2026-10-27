<script setup lang="ts">
import type { Component } from "vue";
import { ChevronRight } from "lucide-vue-next";
import { nextTick, ref, watch } from "vue";

interface DocItem {
  publicPath: string;
  title: string;
  icon?: string;
  depth: 0 | 1;
}
interface DocSectionItem {
  key: string;
  label: string;
  accentHex: string;
  icon: string;
  items: DocItem[];
  total: number;
}

const props = defineProps<{
  sections: DocSectionItem[];
  // Null on pages that don't map to a section.
  currentSectionKey: string | null;
  isActive: (path: string) => boolean;
  iconComponent: (name: string | undefined) => Component | null;
}>();

const emit = defineEmits<{
  (e: "navigate", to: string): void;
}>();

const openKeys = ref<Set<string>>(new Set());

function isOpen(key: string): boolean {
  return openKeys.value.has(key);
}

function hasDropdown(section: DocSectionItem): boolean {
  return section.items.length > 1;
}

function setOpen(key: string, open: boolean) {
  const next = new Set(openKeys.value);
  if (open) next.add(key);
  else next.delete(key);
  openKeys.value = next;
}

// The chevron never navigates, so tidying the sidebar never changes page.
function toggleSection(section: DocSectionItem) {
  setOpen(section.key, !isOpen(section.key));
}

// The header never collapses; that's the chevron's job.
function activateSection(section: DocSectionItem) {
  if (hasDropdown(section)) setOpen(section.key, true);
  const first = section.items[0];
  if (first) emit("navigate", first.publicPath);
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Only adds, never removes, so manually opened sections stay open while navigating.
watch(
  [() => props.currentSectionKey, () => props.sections],
  ([key, sections]) => {
    if (key) setOpen(key, true);
    if (openKeys.value.size === 0 && sections.length > 0) {
      setOpen(sections[0]!.key, true);
    }
  },
  { immediate: true },
);

// Keeps the active link centered so short viewports never scroll it out of view.
const scrollEl = ref<HTMLElement | null>(null);

function scrollChildIntoCenter(container: HTMLElement | null, child: HTMLElement | null) {
  if (!container || !child) return;
  const cRect = container.getBoundingClientRect();
  const tRect = child.getBoundingClientRect();
  container.scrollBy({ top: (tRect.top - cRect.top) - (cRect.height / 2 - tRect.height / 2), behavior: "smooth" });
}

watch(
  () => props.sections.flatMap((s) => s.items).find((i) => props.isActive(i.publicPath))?.publicPath,
  async (path) => {
    if (!path) return;
    await nextTick();
    const container = scrollEl.value;
    scrollChildIntoCenter(container, container?.querySelector<HTMLElement>(`[data-page-path="${path}"]`) ?? null);
  },
  { immediate: true },
);
</script>

<template>
  <div class="docs-nav w-full h-full flex flex-col bg-parchment border-[3px] border-ds-brown/25 overflow-hidden">
    <div class="flex-none px-5 pt-5 pb-3 border-b-2 border-ds-brown/15 flex flex-col gap-2.5">
      <slot name="back" />
      <slot name="search" />
    </div>

    <div ref="scrollEl" class="docs-nav-sections flex-1 basis-0 min-h-0 overflow-y-auto px-3 pt-3 pb-16">
      <div class="flex items-center gap-2 px-2 mb-2">
        <div class="h-px flex-1 bg-ds-brown/20" />
        <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-ds-brown/55">
          {{ $t("docs_nav.sections_label") }}
        </span>
        <div class="h-px flex-1 bg-ds-brown/20" />
      </div>

      <div class="flex flex-col gap-1.5">
        <div v-for="section in sections" :key="section.key" class="flex flex-col">
          <div
            class="docs-nav-chip group relative flex items-center border-[2px] bg-parchment transition-all"
            :class="currentSectionKey === section.key
              ? 'border-ds-brown/45 shadow-[0_1px_0_rgb(104_77_58_/_0.12)]'
              : 'border-ds-brown/15 hover:border-ds-brown/40'"
            :style="currentSectionKey === section.key
              ? { background: `rgba(${hexToRgb(section.accentHex)}, 0.16)` }
              : undefined"
            :data-section-key="section.key"
          >
            <button
              type="button"
              class="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 text-left cursor-pointer transition-colors"
              :class="currentSectionKey === section.key
                ? 'text-ds-brown font-semibold'
                : 'text-ds-brown/80 group-hover:text-ds-brown'"
              :title="section.label"
              @click="activateSection(section)"
            >
              <span
                class="w-[3px] self-stretch transition-opacity -ml-[2px] my-[-2px]"
                :style="{
                  background: section.accentHex,
                  opacity: currentSectionKey === section.key ? 1 : 0.6,
                }"
              />
              <component
                :is="iconComponent(section.icon)"
                v-if="iconComponent(section.icon)"
                :size="16"
                :stroke-width="2"
                :color="section.accentHex"
                class="shrink-0"
              />
              <span class="flex-1 text-sm truncate leading-snug">{{ section.label }}</span>
              <span v-if="hasDropdown(section)" class="text-[10px] text-ds-brown/45 tabular-nums">
                {{ section.total }}
              </span>
            </button>

            <button
              v-if="hasDropdown(section)"
              type="button"
              class="flex-none self-stretch flex items-center px-2 cursor-pointer text-ds-brown/35 hover:text-ds-brown/80 transition-colors"
              :aria-expanded="isOpen(section.key)"
              :aria-label="isOpen(section.key)
                ? $t('docs_nav.collapse_section', { section: section.label })
                : $t('docs_nav.expand_section', { section: section.label })"
              @click="toggleSection(section)"
            >
              <ChevronRight
                :size="14"
                class="shrink-0 transition-transform duration-200 motion-reduce:transition-none"
                :class="isOpen(section.key) ? 'rotate-90' : ''"
              />
            </button>
            <span v-else class="flex-none w-[2px]" />
          </div>

          <!-- Always rendered (height-collapsed) so the grid-rows transition can animate. -->
          <div
            v-if="hasDropdown(section)"
            class="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            :class="isOpen(section.key) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
          >
            <div class="overflow-hidden min-h-0" :inert="!isOpen(section.key)">
              <ul class="flex flex-col gap-1 list-none m-0 pl-2 pr-1 pt-1.5 pb-1">
                <li
                  v-for="item in section.items"
                  :key="item.publicPath"
                  :class="item.depth === 1 ? 'ml-4' : ''"
                >
                  <NuxtLink
                    :to="item.publicPath"
                    class="docs-nav-page group/page relative flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm no-underline cursor-pointer transition-all"
                    :class="isActive(item.publicPath)
                      ? 'text-ds-brown font-semibold bg-ds-brown/5'
                      : 'text-ds-brown/75 hover:text-ds-brown hover:bg-ds-brown/8 hover:translate-x-0.5'"
                    :data-page-path="item.publicPath"
                    @click="emit('navigate', item.publicPath)"
                  >
                    <span
                      class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 transition-opacity"
                      :style="{
                        background: section.accentHex,
                        opacity: isActive(item.publicPath) ? 1 : 0,
                      }"
                    />
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                      :class="isActive(item.publicPath) ? '' : 'bg-ds-brown/30 group-hover/page:bg-ds-brown/60'"
                      :style="isActive(item.publicPath) ? { background: section.accentHex } : {}"
                    />
                    <span class="flex-1 truncate leading-snug" :class="item.depth === 1 ? 'text-xs' : ''">
                      {{ item.title }}
                    </span>
                  </NuxtLink>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docs-nav-chip {
  min-height: 2.2rem;
}
.docs-nav-sections::-webkit-scrollbar {
  width: 6px;
}
.docs-nav-sections::-webkit-scrollbar-thumb {
  background: rgb(104 77 58 / 0.3);
}
.docs-nav-sections::-webkit-scrollbar-track {
  background: transparent;
}
</style>
