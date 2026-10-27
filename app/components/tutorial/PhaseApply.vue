<script setup lang="ts">
import type { TutorialSubStepData } from '~/data/tutorialStepData';
import { renderMd } from '~/utils/formatting';
import { injectGlossaryTerms } from '~/utils/glossary';
import { useGlossaryTooltip } from '~/composables/useGlossaryTooltip';
import CodeEditor from '~/components/tutorial/CodeEditor.vue';
import LivePreview from '~/components/tutorial/LivePreview.vue';
import PhaseLayout from '~/components/tutorial/PhaseLayout.vue';
import CopySnippet from '~/components/tutorial/CopySnippet.vue';
import { ChevronRight, ChevronLeft, AlertTriangle, Undo2, Redo2, Maximize2, Minimize2 } from 'lucide-vue-next';

const props = defineProps<{
  stepData: TutorialSubStepData;
  // Pre-localized by TutorialStep, which falls back to stepData.apply.instructions
  localizedInstructions?: string;
  userCode: { html: string; css: string; readme: string };
  isFirstStep: boolean;
  isLastStep: boolean;
  canGoBack?: boolean;
  isRevisiting?: boolean;
  // Parent-owned error (e.g. README image gate); cleared via clearExternalError on edit
  externalError?: string;
}>();
const emit = defineEmits<{
  complete: [userCode: { html: string; css: string; readme: string }];
  back: [];
  save: [userCode: { html: string; css: string; readme: string }];
  clearExternalError: [];
}>();

// Forwarded to the AI endpoints so feedback comes back in the learner's language
const { locale: uiLocale } = useI18n();

const applyStarter = props.stepData.apply.starterCode;
const html = ref(props.isFirstStep && applyStarter?.html ? applyStarter.html : (props.isFirstStep ? '' : props.userCode.html));
const css = ref(props.isFirstStep && applyStarter?.css ? applyStarter.css : (props.isFirstStep ? '' : props.userCode.css));
const readme = ref(props.isFirstStep ? '' : props.userCode.readme);

const isReadmeStep = computed(() => props.stepData.id === 'readme');

const instructionsSource = computed(
  () => props.localizedInstructions || props.stepData.apply.instructions || '',
);
const enrichedInstructions = computed(() =>
  instructionsSource.value ? injectGlossaryTerms(instructionsSource.value) : '',
);

const { tooltipText, tooltipVisible, tooltipStyle, onMouseOver: onGlossaryMouseOver, onMouseOut: onGlossaryMouseOut } = useGlossaryTooltip();

const showReference = ref(false);

const hint = ref('');
const hintLoading = ref(false);
const hintHistory = ref<string[]>([]);

async function getHint() {
  hintLoading.value = true;
  try {
    const previousHints = hintHistory.value.length > 0
      ? `\n\nI have already received these hints but I am still stuck:\n${hintHistory.value.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nPlease give me a MORE specific and detailed hint this time.`
      : '';

    const res = await $fetch<{ hint: string }>('/api/ai/hint', {
      method: 'POST',
      body: {
        html: html.value,
        css: css.value,
        currentStep: props.stepData.id,
        error: previousHints,
        locale: uiLocale.value,
      },
    });
    hint.value = res.hint;
    hintHistory.value.push(res.hint);
  } catch {
    const { t } = useNuxtApp().$i18n as { t: (key: string) => string };
    hint.value = t("phase_apply.hint_fallback");
  } finally {
    hintLoading.value = false;
  }
}

const validationError = ref('');
const validating = ref(false);

// One slot: the local error wins over the parent's externalError so banners never stack
const displayedError = computed(() => validationError.value || props.externalError || '');

async function validateStep(): Promise<boolean> {
  validating.value = true;
  validationError.value = '';
  try {
    const res = await $fetch<{ passed: boolean; feedback: string }>('/api/ai/validate', {
      method: 'POST',
      body: {
        html: html.value,
        css: css.value,
        readme: readme.value,
        stepId: props.stepData.apply.validationStepId,
        locale: uiLocale.value,
      },
    });
    if (!res.passed) {
      validationError.value = res.feedback;
      return false;
    }
    return true;
  } catch {
    return true; // Don't block on validation failure
  } finally {
    validating.value = false;
  }
}

const errorDetail = computed<string | null>(() => {
  if (isReadmeStep.value) return null;
  const htmlCode = html.value;

  for (const line of htmlCode.split('\n')) {
    let inTag = false;
    for (const ch of line) {
      if (ch === '<') {
        if (inTag) return "You have a &lt; without a matching &gt;.";
        inTag = true;
      } else if (ch === '>') {
        inTag = false;
      }
    }
    if (inTag) return "You have a &lt; without a matching &gt;.";
  }

  const selfClosing = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  const tagStack: string[] = [];
  const tagRe = /<(\/?)(\w+)[^>]*>/g;
  let m;
  while ((m = tagRe.exec(htmlCode)) !== null) {
    const tag = m[2]!.toLowerCase();
    if (tag === '!doctype' || selfClosing.has(tag) || /\/\s*>$/.test(m[0]!)) continue;
    if (m[1] !== '/') {
      tagStack.push(tag);
    } else {
      const last = tagStack.lastIndexOf(tag);
      if (last !== -1) tagStack.splice(last);
      else return `You have an extra &lt;/${tag}&gt; closing tag without a matching opening tag.`;
    }
  }
  if (tagStack.length > 0) {
    const unclosed = tagStack[tagStack.length - 1];
    return `You have an unclosed &lt;${unclosed}&gt; tag. Add &lt;/${unclosed}&gt; to close it.`;
  }

  const cssCode = css.value;
  if (cssCode) {
    const opens = (cssCode.match(/\{/g) || []).length;
    const closes = (cssCode.match(/\}/g) || []).length;
    if (opens > closes) return "You have an unclosed { in your CSS. Add a } to close it.";
    if (closes > opens) return "You have an extra } in your CSS without a matching {.";
  }
  return null;
});

const hasErrors = computed(() => !!errorDetail.value);

const submitted = ref(false);

async function handleNext() {
  if (validating.value || submitted.value) return;
  if (hasErrors.value) {
    const { t } = useNuxtApp().$i18n as { t: (key: string) => string };
    validationError.value = t("phase_apply.fix_syntax_first") + (errorDetail.value ? " " + errorDetail.value : "");
    return;
  }
  if (props.isRevisiting) {
    submitted.value = true;
    emit('complete', { html: html.value, css: css.value, readme: readme.value });
    return;
  }
  if (await validateStep()) {
    submitted.value = true;
    emit('complete', { html: html.value, css: css.value, readme: readme.value });
  }
}

watch(
  [html, css, readme],
  () => {
    if (validationError.value) {
      validationError.value = '';
    }
    if (props.externalError) {
      emit('clearExternalError');
    }
  },
);

// The parent can reject after local validation passed (e.g. image gate); reset so Done isn't stuck disabled
watch(
  () => props.externalError,
  (val) => {
    if (val && submitted.value) submitted.value = false;
  },
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  [html, css, readme],
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      emit('save', { html: html.value, css: css.value, readme: readme.value });
    }, 1500); // debounce autosave while typing
  },
);

const previewRef = ref<InstanceType<typeof LivePreview> | null>(null);
const htmlEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
const cssEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null);

function onElementClick(line: number) {
  htmlEditorRef.value?.highlightLine(line);
}

const expandedEditor = ref<'html' | 'css' | null>(null);

function toggleExpand(which: 'html' | 'css') {
  expandedEditor.value = expandedEditor.value === which ? null : which;
}

function onExpandKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && expandedEditor.value) {
    expandedEditor.value = null;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onExpandKeydown);
});

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  window.removeEventListener('keydown', onExpandKeydown);
});
</script>

<template>
  <PhaseLayout :left-label="$t('tutorial_ui.tab_code')">
    <template #left>
      <div
        v-if="displayedError"
        class="px-4 py-3 text-sm font-medium bg-ds-danger/10 text-ds-danger border-b border-ds-danger/30"
      >
        <div class="flex items-start gap-2">
          <AlertTriangle :size="16" class="shrink-0 mt-0.5" />
          <!-- renderMd escapes angle brackets in AI feedback so v-html doesn't strip them as tags -->
          <span v-html="renderMd(displayedError)" />
        </div>
      </div>

      <div
        v-if="instructionsSource"
        class="px-4 py-3 text-sm text-ds-brown border-b border-ds-brown/10 leading-relaxed [&_code]:bg-ds-brown/5 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono"
        spellcheck="false"
        @mouseover="onGlossaryMouseOver"
        @mouseout="onGlossaryMouseOut"
        v-html="enrichedInstructions"
      />

      <div v-if="stepData.explain.snippets.length > 0" class="border-b border-ds-brown/10">
        <button
          class="w-full px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ds-brown/70 hover:text-ds-brown/60 transition-colors flex items-center gap-1.5"
          @click="showReference = !showReference"
        >
          <ChevronRight
            :size="14"
            class="transition-transform duration-200"
            :class="showReference ? 'rotate-90' : ''"
          />
          {{ showReference ? $t("phase_apply.hide_reference") : $t("phase_apply.show_reference") }}
        </button>
        <div v-if="showReference" class="px-4 pb-4 space-y-3 max-h-64 overflow-y-auto">
          <CopySnippet
            v-for="(snippet, i) in stepData.explain.snippets"
            :key="i"
            :code="snippet.code"
            :language="snippet.language"
            :label="snippet.label"
          />
        </div>
      </div>

      <div class="border-b border-ds-brown/10">
        <button
          class="w-full text-sm font-medium text-ds-brown bg-parchment border-[3px] border-[#684D3A] px-3 py-1.5 hover:brightness-95 transition-all"
          :disabled="hintLoading"
          @click="getHint"
        >
          {{ hintLoading ? $t("phase_apply.thinking") : hint ? $t("phase_apply.another_hint") : $t("phase_apply.stuck_hint") }}
        </button>
        <Transition name="hint-expand">
          <div
            v-if="hint"
            class="text-sm text-[#684D3A] leading-relaxed bg-transparent border-[3px] border-t-0 border-[#684D3A] px-3 py-2 overflow-hidden"
            v-html="renderMd(hint)"
          />
        </Transition>
      </div>

      <template v-if="isReadmeStep">
        <div class="flex-1 flex flex-col min-h-0">
          <div class="px-4 py-2 border-b border-ds-brown/10 text-xs font-bold uppercase tracking-wider text-ds-brown/70">
            README.md
          </div>
          <textarea
            v-model="readme"
            class="flex-1 w-full font-mono text-sm p-4 resize-none bg-transparent focus:outline-none"
            spellcheck="false"
          />
        </div>
      </template>

      <template v-else>
        <div
          class="flex flex-col min-h-0"
          :class="expandedEditor === 'html'
            ? 'fixed inset-0 z-50 bg-parchment'
            : (stepData.tinker.showCssEditor ? 'h-1/2' : 'flex-1')"
        >
          <div class="px-4 py-2 border-b border-ds-brown/10 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-ds-brown/70">index.html</span>
            <div class="flex items-center gap-1">
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!htmlEditorRef?.canUndo"
                :title="$t('phase_apply.undo')"
                @click="htmlEditorRef?.undo()"
              >
                <Undo2 :size="16" />
              </button>
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!htmlEditorRef?.canRedo"
                :title="$t('phase_apply.redo')"
                @click="htmlEditorRef?.redo()"
              >
                <Redo2 :size="16" />
              </button>
              <button
                type="button"
                class="p-1 text-ds-brown/60 hover:text-ds-brown transition-colors"
                :title="expandedEditor === 'html' ? $t('tutorial_ui.collapse_editor') : $t('tutorial_ui.expand_editor')"
                @click="toggleExpand('html')"
              >
                <component :is="expandedEditor === 'html' ? Minimize2 : Maximize2" :size="16" />
              </button>
            </div>
          </div>
          <CodeEditor
            ref="htmlEditorRef"
            v-model="html"
            language="html"
          />
        </div>

        <div
          v-if="stepData.tinker.showCssEditor"
          class="flex flex-col min-h-0"
          :class="expandedEditor === 'css'
            ? 'fixed inset-0 z-50 bg-parchment'
            : 'h-1/2 border-t border-ds-brown/10'"
        >
          <div class="px-4 py-2 border-b border-ds-brown/10 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-ds-brown/70">style.css</span>
            <div class="flex items-center gap-1">
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!cssEditorRef?.canUndo"
                :title="$t('phase_apply.undo')"
                @click="cssEditorRef?.undo()"
              >
                <Undo2 :size="16" />
              </button>
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!cssEditorRef?.canRedo"
                :title="$t('phase_apply.redo')"
                @click="cssEditorRef?.redo()"
              >
                <Redo2 :size="16" />
              </button>
              <button
                type="button"
                class="p-1 text-ds-brown/60 hover:text-ds-brown transition-colors"
                :title="expandedEditor === 'css' ? $t('tutorial_ui.collapse_editor') : $t('tutorial_ui.expand_editor')"
                @click="toggleExpand('css')"
              >
                <component :is="expandedEditor === 'css' ? Minimize2 : Maximize2" :size="16" />
              </button>
            </div>
          </div>
          <CodeEditor
            ref="cssEditorRef"
            v-model="css"
            language="css"
          />
        </div>
      </template>

      <div class="flex items-stretch gap-3 px-4 py-4 border-t border-ds-brown/10">
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
          :disabled="validating || submitted"
          @click="handleNext"
        >
          {{ validating ? $t('phase_apply.checking') : submitted ? $t('phase_apply.done') : isLastStep ? $t('phase_apply.finish') : $t('common.next') }}
        </button>
      </div>
      <!-- Fixed-positioned, so its DOM location doesn't affect placement -->
      <div
        v-if="tooltipVisible"
        class="glossary-tooltip"
        :style="tooltipStyle"
      >
        {{ tooltipText }}
      </div>
    </template>
    <template #right>
      <LivePreview
        ref="previewRef"
        :html="html"
        :css="css"
        :mode="isReadmeStep ? 'readme' : 'html'"
        :readme-content="readme"
        :linking-enabled="!isReadmeStep"
        :require-css-link="stepData.tinker.showCssEditor"
        @element-click="onElementClick"
      />
    </template>
  </PhaseLayout>
</template>

<style scoped>
.hint-expand-enter-active {
  transition: max-height 0.4s ease, opacity 0.3s ease;
}
.hint-expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.2s ease;
}
.hint-expand-enter-from,
.hint-expand-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.hint-expand-enter-to,
.hint-expand-leave-from {
  max-height: 300px;
  opacity: 1;
}

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
</style>
