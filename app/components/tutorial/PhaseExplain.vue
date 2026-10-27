<script setup lang="ts">
import type { CopyableSnippet } from '~/data/tutorialStepData';
import CopySnippet from '~/components/tutorial/CopySnippet.vue';
import LivePreview from '~/components/tutorial/LivePreview.vue';
import PhaseLayout from '~/components/tutorial/PhaseLayout.vue';
import { injectGlossaryTerms } from '~/utils/glossary';
import { useGlossaryTooltip } from '~/composables/useGlossaryTooltip';
import { ChevronLeft } from 'lucide-vue-next';

const props = defineProps<{
  content: string;
  snippets: CopyableSnippet[];
  learnMoreLinks: { label: string; url: string }[];
  previewCode: { html: string; css?: string; readme?: string };
  isReadme: boolean;
  canGoBack: boolean;
}>();
const emit = defineEmits<{ ready: []; back: [] }>();

const enrichedContent = computed(() => injectGlossaryTerms(props.content));

const scrollContainerRef = ref<HTMLElement | null>(null);
const { tooltipText, tooltipVisible, tooltipStyle, onMouseOver, onMouseOut } = useGlossaryTooltip();
</script>

<template>
  <PhaseLayout :left-label="$t('tutorial_ui.tab_instructions')">
    <template #left>
      <div ref="scrollContainerRef" class="flex-1 overflow-y-auto p-8 bg-parchment relative min-h-0">
        <p class="text-xs font-bold uppercase tracking-wider text-ds-brown/40 mb-4">
          {{ $t("phase_explain.heading") }}
        </p>

        <!-- Tailwind preflight strips h3/h4/ul/li styling, so re-apply it via child selectors -->
        <div
          class="text-sm leading-relaxed text-ds-brown space-y-3
                 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-1 [&_h3]:mb-2
                 [&_h4]:text-base [&_h4]:font-bold [&_h4]:mt-4 [&_h4]:mb-1
                 [&_p]:leading-relaxed
                 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
                 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1
                 [&_li]:pl-0.5
                 [&_code]:bg-ds-brown/8 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                 [&_strong]:font-semibold"
          @mouseover="onMouseOver"
          @mouseout="onMouseOut"
          v-html="enrichedContent"
        />

        <div
          v-if="tooltipVisible"
          class="glossary-tooltip"
          :style="tooltipStyle"
        >
          {{ tooltipText }}
        </div>

        <div v-if="snippets.length > 0" class="mt-6 space-y-3">
          <p class="text-xs font-bold uppercase tracking-wider text-ds-brown/40">
            {{ $t("phase_explain.key_snippets") }}
          </p>
          <CopySnippet
            v-for="(snippet, i) in snippets"
            :key="i"
            :code="snippet.code"
            :language="snippet.language"
            :label="snippet.label"
          />
        </div>

        <div v-if="learnMoreLinks.length > 0" class="mt-6 space-y-1.5">
          <p class="text-xs font-bold uppercase tracking-wider text-ds-brown/40 mb-2">
            {{ $t("phase_explain.learn_more") }}
          </p>
          <div v-for="(link, i) in learnMoreLinks" :key="i">
            <a
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-ds-brown/40 text-xs underline hover:text-ds-brown/70 transition-colors"
            >
              {{ link.label }}
            </a>
          </div>
        </div>
      </div>

      <div class="flex items-stretch gap-3 px-8 py-6 border-t border-ds-brown/10 shrink-0">
        <button
          v-if="canGoBack"
          class="ds-btn-primary flex items-center justify-center shrink-0 px-3"
          :title="$t('phase_goal.go_back')"
          @click="emit('back')"
        >
          <ChevronLeft :size="20" />
        </button>
        <button
          class="flex-1 ds-btn-primary"
          @click="emit('ready')"
        >
          {{ $t("phase_explain.got_it") }}
        </button>
      </div>
    </template>
    <template #right>
      <LivePreview
        :html="previewCode.html"
        :css="previewCode.css || ''"
        :mode="isReadme ? 'readme' : 'html'"
        :readme-content="previewCode.readme"
      />
    </template>
  </PhaseLayout>
</template>

<style scoped>
.glossary-tooltip {
  position: absolute;
  background: rgb(104 77 58);
  color: rgb(234 207 179);
  font-size: 0.7rem;
  font-weight: 500;
  line-height: 1.4;
  padding: 6px 10px;
  border-radius: 4px;
  max-width: 240px;
  z-index: 50;
  pointer-events: none;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
}

.glossary-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: var(--arrow-offset-x, 50%);
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgb(104 77 58);
}

.glossary-fade-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.glossary-fade-leave-active {
  transition: opacity 0.1s ease;
}
.glossary-fade-enter-from,
.glossary-fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* Global because glossary terms are injected via v-html; colors match ds-btn-primary. */
.glossary-term[data-glossary] {
  cursor: help;
  text-decoration: none;
  background-color: #684D3A;
  color: #F6E5C7;
  padding: 1px 7px;
  border-radius: 0;
  font-weight: 600;
  transition: background-color 0.15s ease;
  white-space: nowrap;
}

.glossary-term[data-glossary]:hover {
  background-color: rgba(104, 77, 58, 0.9);
}
</style>
