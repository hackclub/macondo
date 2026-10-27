<script setup lang="ts">
import { highlightHtml, highlightCss, esc } from '~/utils/formatting';

const props = defineProps<{
  code: string;
  language: "html" | "css" | "markdown";
  label?: string;
}>();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const highlightedCode = computed(() => {
  if (props.language === 'html') return highlightHtml(props.code);
  if (props.language === 'css') return highlightCss(props.code);
  return esc(props.code);
});

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(props.code);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // clipboard write failed silently
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="copy-snippet">
    <div v-if="label" class="text-xs font-medium text-ds-brown/50 mb-1 select-none">{{ label }}</div>
    <button
      type="button"
      class="relative group cursor-pointer bg-ds-brown/5 border-[3px] border-ds-brown/10 overflow-hidden block w-full text-left"
      :aria-label="$t('copy_snippet.click_to_copy')"
      @click="copyToClipboard"
    >
      <div class="absolute top-1.5 right-2 z-10 select-none pointer-events-none flex items-center gap-1">
        <Transition name="copied-fade" mode="out-in">
          <span
            v-if="copied"
            key="copied"
            class="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded"
          >
            {{ $t("copy_snippet.copied") }}
          </span>
          <span
            v-else
            key="hint"
            class="text-[10px] text-ds-brown/30 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          >
            {{ $t("copy_snippet.click_to_copy") }}
          </span>
        </Transition>
      </div>

      <pre
        class="font-mono text-xs leading-relaxed px-3 py-2.5 m-0 overflow-x-auto whitespace-pre-wrap break-words"
        v-html="highlightedCode"
      />
    </button>
  </div>
</template>

<style scoped>
.copy-snippet pre {
  tab-size: 2;
}

.copied-fade-enter-active,
.copied-fade-leave-active {
  transition: opacity 0.2s ease;
}
.copied-fade-enter-from,
.copied-fade-leave-to {
  opacity: 0;
}
</style>
