<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { Search } from "lucide-vue-next";
import { useDocsSearch } from "~/composables/useDocsSearch";

const props = defineProps<{
  variant?: "pill" | "icon";
}>();

const { t, locale } = useI18n();
const { openSearch } = useDocsSearch(locale.value as "en" | "es");

// null until mount so SSR and hydration agree.
const isMac = ref<boolean | null>(null);
onMounted(() => {
  if (typeof navigator === "undefined") return;
  isMac.value = /mac/i.test(
    (navigator.userAgentData as { platform?: string } | undefined)?.platform
      ?? navigator.platform
      ?? "",
  );
});

const kbdLabel = computed(() => {
  if (isMac.value === null) return "\u2318K";
  return isMac.value ? "\u2318K" : "Ctrl K";
});

const isIcon = computed(() => props.variant === "icon");
</script>

<template>
  <button
    v-if="isIcon"
    type="button"
    class="inline-flex items-center justify-center w-10 h-10 border-[3px] border-ds-brown bg-parchment text-ds-brown shadow-md hover:bg-ds-brown/5 transition-colors"
    :aria-label="t('docs_search.trigger')"
    @click="openSearch"
  >
    <Search :size="20" />
  </button>

  <button
    v-else
    type="button"
    class="docs-search-trigger group w-full flex items-center gap-2.5 px-3 py-2 border-[2px] border-ds-brown/25 bg-white/55 text-ds-brown/70 hover:text-ds-brown hover:border-ds-brown/50 hover:bg-white/80 transition-all cursor-text text-left"
    @click="openSearch"
  >
    <Search :size="14" class="text-ds-brown/55 shrink-0" />
    <span class="flex-1 text-sm font-medium truncate">{{ t("docs_search.trigger") }}</span>
    <kbd class="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-ds-brown/30 bg-parchment text-[10px] font-bold text-ds-brown/60 tabular-nums">
      {{ kbdLabel }}
    </kbd>
  </button>
</template>

<style scoped>
.docs-search-trigger:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 0 rgb(104 77 58 / 0.15);
}
</style>
