<script setup lang="ts">
import LivePreview from '~/components/tutorial/LivePreview.vue';
import PhaseLayout from '~/components/tutorial/PhaseLayout.vue';
import { injectGlossaryTerms } from '~/utils/glossary';
import { useGlossaryTooltip } from '~/composables/useGlossaryTooltip';
import { localizeTutorialHtml } from '~/utils/localizeTutorialHtml';
import { ChevronLeft } from 'lucide-vue-next';

const props = defineProps<{
  description: string;
  previewCode: { html: string; css?: string; readme?: string };
  isReadme: boolean;
  canGoBack: boolean;
}>();
const emit = defineEmits<{ ready: []; back: [] }>();

const enrichedDescription = computed(() => injectGlossaryTerms(props.description));

const { locale: uiLocale } = useI18n();
// Starter content is authored in English, so localize the preview's visible copy
const localizedPreview = computed(() => ({
  html: localizeTutorialHtml(props.previewCode.html, uiLocale.value),
  css: props.previewCode.css || '',
  readme: props.previewCode.readme ? localizeTutorialHtml(props.previewCode.readme, uiLocale.value) : undefined,
}));

const containerRef = ref<HTMLElement | null>(null);
const { tooltipText, tooltipVisible, tooltipStyle, onMouseOver, onMouseOut } = useGlossaryTooltip();
</script>

<template>
  <PhaseLayout :left-label="$t('tutorial_ui.tab_instructions')">
    <template #left>
      <div ref="containerRef" class="flex flex-col h-full min-h-0 bg-parchment p-8 relative">
        <p class="text-xs font-bold uppercase tracking-wider text-ds-brown/40 mb-4">
          {{ $t("phase_goal.heading") }}
        </p>
        <p
          class="text-base text-ds-brown leading-relaxed flex-1 min-h-0 overflow-y-auto"
          spellcheck="false"
          @mouseover="onMouseOver"
          @mouseout="onMouseOut"
          v-html="enrichedDescription"
        />
        <div
          v-if="tooltipVisible"
          class="glossary-tooltip"
          :style="tooltipStyle"
        >
          {{ tooltipText }}
        </div>
        <div class="flex items-stretch gap-3 pt-6">
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
            {{ $t("phase_goal.let_me_try") }}
          </button>
        </div>
      </div>
    </template>
    <template #right>
      <LivePreview
        :html="localizedPreview.html"
        :css="localizedPreview.css"
        :mode="isReadme ? 'readme' : 'html'"
        :readme-content="localizedPreview.readme"
      />
    </template>
  </PhaseLayout>
</template>

<style scoped>
.glossary-tooltip {
  position: fixed;
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
</style>
