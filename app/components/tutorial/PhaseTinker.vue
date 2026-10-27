<script setup lang="ts">
import type { TutorialSubStepData } from '~/data/tutorialStepData';
import CodeEditor from '~/components/tutorial/CodeEditor.vue';
import LivePreview from '~/components/tutorial/LivePreview.vue';
import PhaseLayout from '~/components/tutorial/PhaseLayout.vue';
import { injectGlossaryTerms } from '~/utils/glossary';
import { useGlossaryTooltip } from '~/composables/useGlossaryTooltip';
import { useNotebookState } from '~/composables/useNotebookState';
import { localizeTutorialHtml } from '~/utils/localizeTutorialHtml';
import { Undo2, Redo2, ChevronLeft, Maximize2, Minimize2 } from 'lucide-vue-next';

// Localizes the starter code's visible copy; tags, classes and URLs are left untouched
const { locale: uiLocale } = useI18n();

const { hasBeenOpened: hasOpenedNotebook, markOpened } = useNotebookState();

function challengeContext() {
  return { hasOpenedNotebook: hasOpenedNotebook.value };
}

const props = defineProps<{
  stepData: TutorialSubStepData;
  initialCode?: { html: string; css: string; readme: string };
  initialChallengesCompleted?: number[];
  userCode?: { html: string; css: string; readme: string };
  canGoBack: boolean;
  isRevisiting?: boolean;
}>();

// The opened flag resets on reload/hydration, so restore it when open_notebook was already
// passed; otherwise the re-validation below would fail it.
const openNotebookChallengeIdx = props.stepData.tinker.challenges.findIndex(
  (c) => c.id === 'open_notebook',
);
if (
  openNotebookChallengeIdx !== -1 &&
  props.initialChallengesCompleted?.includes(openNotebookChallengeIdx)
) {
  markOpened();
}
const emit = defineEmits<{
  ready: [];
  back: [];
  save: [tinkerCode: { html: string; css: string; readme: string }, challengesCompleted: number[]];
}>();

function buildTinkerCode(field: 'html' | 'css' | 'readme'): string {
  if (props.initialCode?.[field]) return props.initialCode[field];

  const rawStarter = (field === 'html'
    ? props.stepData.tinker.starterCode.html
    : field === 'css'
      ? props.stepData.tinker.starterCode.css
      : props.stepData.tinker.starterCode.readme) || '';
  // CSS doesn't carry user-facing text, so only touch HTML / readme.
  const starter = field === 'css'
    ? rawStarter
    : localizeTutorialHtml(rawStarter, uiLocale.value);
  const userVal = props.userCode?.[field] || '';

  if (!userVal) return starter;

  if (field === 'html') {
    return starter;
  }

  if (field === 'css') {
    return starter || userVal;
  }

  return starter || userVal;
}

const tinkerHtml = ref(buildTinkerCode('html'));
const tinkerCss = ref(buildTinkerCode('css'));
const tinkerReadme = ref(buildTinkerCode('readme'));

const challengesCompleted = ref<number[]>((() => {
  // Revisiting a passed sub-step marks every challenge done so the learner needn't redo the edits
  if (props.isRevisiting) {
    return props.stepData.tinker.challenges.map((_, i) => i);
  }

  if (!props.initialChallengesCompleted?.length) return [];
  // Re-validate persisted completions against current code
  const code = { html: tinkerHtml.value, css: tinkerCss.value, readme: tinkerReadme.value };
  const challenges = props.stepData.tinker.challenges;
  const ctx = challengeContext();
  const valid: number[] = [];
  for (const idx of props.initialChallengesCompleted) {
    const challenge = challenges[idx];
    if (challenge && challenge.check(code, ctx)) {
      valid.push(idx);
    } else {
      break;
    }
  }
  return valid;
})());

const currentChallengeIndex = computed(() => {
  const challenges = props.stepData.tinker.challenges;
  for (let i = 0; i < challenges.length; i++) {
    if (!challengesCompleted.value.includes(i)) return i;
  }
  return -1;
});

const freeFormEditMade = ref(false);

// Watches hasOpenedNotebook so non-code challenges fire too, and loops so a challenge satisfied
// out of order (e.g. opening the Notebook early) registers without waiting for another edit.
watch(
  [tinkerHtml, tinkerCss, tinkerReadme, hasOpenedNotebook],
  () => {
    const code = { html: tinkerHtml.value, css: tinkerCss.value, readme: tinkerReadme.value };
    const ctx = challengeContext();
    const challenges = props.stepData.tinker.challenges;

    while (true) {
      const idx = currentChallengeIndex.value;
      if (idx === -1) {
        freeFormEditMade.value = true;
        return;
      }
      const challenge = challenges[idx];
      if (!challenge || hasErrors.value || !challenge.check(code, ctx)) return;
      challengesCompleted.value = [...challengesCompleted.value, idx];
      if (idx === challenges.length - 1 && !props.stepData.tinker.freeFormPrompt) {
        freeFormEditMade.value = true;
      }
    }
  },
  { flush: 'post' }
);

const activeError = computed(() => {
  const original = {
    html: props.stepData.tinker.starterCode.html || '',
    css: props.stepData.tinker.starterCode.css || '',
    readme: props.stepData.tinker.starterCode.readme || '',
  };
  const current = { html: tinkerHtml.value, css: tinkerCss.value, readme: tinkerReadme.value };
  for (const err of props.stepData.tinker.errors) {
    const line = err.detect(current, original);
    if (line !== false) {
      return { line, message: err.message, file: err.file };
    }
  }
  return null;
});

const dismissedMessage = ref<string | null>(null);
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => activeError.value?.message,
  (newMsg) => {
    if (newMsg !== dismissedMessage.value) {
      dismissedMessage.value = null;
    }
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (newMsg) {
      dismissTimer = setTimeout(() => {
        dismissedMessage.value = newMsg;
      }, 5000); // auto-dismiss errors after 5s
    }
  }
);

onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer);
  if (saveTimer) clearTimeout(saveTimer);
});

const _visibleError = computed(() => {
  if (!activeError.value) return null;
  if (activeError.value.message === dismissedMessage.value) return null;
  return activeError.value;
});

const htmlTeachingError = computed(() => {
  if (activeError.value && activeError.value.file === 'html') {
    return { line: activeError.value.line, message: activeError.value.message };
  }
  return null;
});

const cssTeachingError = computed(() => {
  if (activeError.value && activeError.value.file === 'css') {
    return { line: activeError.value.line, message: activeError.value.message };
  }
  return null;
});

const errorDetail = computed<string | null>(() => {
  if (isReadmeStep.value) return null;
  const htmlCode = tinkerHtml.value;

  if (/<\s+\w/i.test(htmlCode)) return "You have a space after the &lt; in a tag.";
  if (/<\/?\w+\s+>/i.test(htmlCode)) return "You have a space before the &gt; in a tag.";

  if (/<\\\w+>/i.test(htmlCode)) return "You used a backslash (\\) instead of a forward slash (/) in a closing tag.";

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

  const tagRawRe = /<\w+([^>]*)>/g;
  let tagMatch;
  while ((tagMatch = tagRawRe.exec(htmlCode)) !== null) {
    if (/(?<!=)""/.test(tagMatch[1] || '')) return "You have mismatched quotes in an attribute.";
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

  const cssCode = tinkerCss.value;
  if (cssCode) {
    const opens = (cssCode.match(/\{/g) || []).length;
    const closes = (cssCode.match(/\}/g) || []).length;
    if (opens > closes) return "You have an unclosed { in your CSS. Add a } to close it.";
    if (closes > opens) return "You have an extra } in your CSS without a matching {.";
  }
  return null;
});

const hasErrors = computed(() => !!errorDetail.value);

const freeFormPassed = computed(() => {
  const check = props.stepData.tinker.freeFormCheck;
  if (!check) return true;
  return check({ html: tinkerHtml.value, css: tinkerCss.value, readme: tinkerReadme.value });
});

const requirePreviewClick = computed(() => props.stepData.tinker.requirePreviewClick ?? false);

const showReadyButton = computed(() => {
  if (props.isRevisiting) return true;
  if (currentChallengeIndex.value !== -1 || hasErrors.value || activeError.value || !freeFormPassed.value) return false;
  if (requirePreviewClick.value && !hasClickedPreview.value) return false;
  return true;
});

// On Add Tailwind the most common error is a CDN URL typo, so surface errors even mid-challenge
const isErrorPrioritizedStep = computed(() => props.stepData.id === 'add_tailwind');

const { t, te } = useI18n();

function resolveTutorialString(raw: string): string {
  if (!raw) return '';
  const key = `tutorial_challenges.${raw}`;
  if (te(key)) return t(key);
  return raw;
}

const challengeBannerText = computed(() => {
  const idx = currentChallengeIndex.value;
  if (isErrorPrioritizedStep.value && (hasErrors.value || activeError.value)) {
    return t('tutorial_challenges.banner_fix_errors') + (errorDetail.value ? " " + errorDetail.value : "");
  }
  if (idx !== -1) {
    const challenge = props.stepData.tinker.challenges[idx];
    if (!challenge) return '';
    const key = `tutorial_challenges.${challenge.id}`;
    return te(key) ? t(key) : (challenge.prompt ?? '');
  }
  if (hasErrors.value || activeError.value) {
    return t('tutorial_challenges.banner_fix_errors') + (errorDetail.value ? " " + errorDetail.value : "");
  }
  if (requirePreviewClick.value && !hasClickedPreview.value) {
    return t('tutorial_challenges.banner_click_preview');
  }
  if (showReadyButton.value) {
    return t('tutorial_challenges.banner_ready_move_on');
  }
  const raw = props.stepData.tinker.freeFormPrompt;
  if (raw) return resolveTutorialString(raw);
  return t('tutorial_challenges.banner_keep_exploring');
});

const enrichedChallengeBannerText = computed(() =>
  injectGlossaryTerms(challengeBannerText.value),
);

// The banner sits at the top, so the composable's flip-below logic keeps the tooltip from clipping
const { tooltipText, tooltipVisible, tooltipStyle, onMouseOver, onMouseOut } = useGlossaryTooltip();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  [tinkerHtml, tinkerCss, tinkerReadme, challengesCompleted],
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      emit(
        'save',
        { html: tinkerHtml.value, css: tinkerCss.value, readme: tinkerReadme.value },
        [...challengesCompleted.value]
      );
    }, 1500); // debounce autosave while typing
  },
  { deep: true }
);

const previewRef = ref<InstanceType<typeof LivePreview> | null>(null);
const htmlEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
const cssEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
const isReadmeStep = computed(() => props.stepData.id === 'readme');

const hasClickedPreview = ref(false);

function onElementClick(line: number) {
  htmlEditorRef.value?.highlightLine(line);
  hasClickedPreview.value = true;
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
  window.removeEventListener('keydown', onExpandKeydown);
});

</script>

<template>
  <PhaseLayout :left-label="$t('tutorial_ui.tab_code')">
    <template #left>
      <div
        :key="challengeBannerText"
        class="challenge-banner px-4 py-3 text-sm font-medium border-b border-ds-brown/10"
        :class="(hasErrors || activeError) && (currentChallengeIndex === -1 || isErrorPrioritizedStep) ? 'bg-ds-danger/10 text-ds-danger' : showReadyButton ? 'bg-ds-success/10 text-ds-success' : 'bg-ds-warning/10 text-ds-brown'"
        spellcheck="false"
        @mouseover="onMouseOver"
        @mouseout="onMouseOut"
      >
        <span v-if="currentChallengeIndex !== -1" class="inline-block mr-1.5 text-xs font-bold uppercase tracking-wider opacity-60">
          {{ $t("tutorial_ui.challenge_of", { current: currentChallengeIndex + 1, total: stepData.tinker.challenges.length }) }}
        </span>
        <span class="[&_code]:bg-ds-brown/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono" v-html="enrichedChallengeBannerText" />
      </div>
      <div
        v-if="tooltipVisible"
        class="glossary-tooltip"
        :style="tooltipStyle"
      >
        {{ tooltipText }}
      </div>

      <template v-if="isReadmeStep">
        <div class="flex-1 flex flex-col min-h-0">
          <div class="px-4 py-2 border-b border-ds-brown/10 text-xs font-bold uppercase tracking-wider text-ds-brown/70">
            README.md
          </div>
          <textarea
            v-model="tinkerReadme"
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
                title="Undo"
                @click="htmlEditorRef?.undo()"
              >
                <Undo2 :size="16" />
              </button>
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!htmlEditorRef?.canRedo"
                title="Redo"
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
            v-model="tinkerHtml"
            language="html"
            :teaching-error="htmlTeachingError"
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
                title="Undo"
                @click="cssEditorRef?.undo()"
              >
                <Undo2 :size="16" />
              </button>
              <button
                class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                :disabled="!cssEditorRef?.canRedo"
                title="Redo"
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
            v-model="tinkerCss"
            language="css"
            :teaching-error="cssTeachingError"
          />
        </div>
      </template>

      <div class="flex items-stretch gap-3 px-4 py-4 border-t border-ds-brown/10">
        <button
          v-if="canGoBack"
          class="ds-btn-primary flex items-center justify-center shrink-0 px-3"
          :title="$t('tutorial_ui.go_back')"
          @click="emit('back')"
        >
          <ChevronLeft :size="20" />
        </button>

        <Transition name="ready-fade">
          <button
            v-if="showReadyButton"
            class="flex-1 ds-btn-primary ready-button"
            @click="emit('ready')"
          >
            {{ $t("tutorial_ui.ready_to_learn") }}
          </button>
        </Transition>
        <div v-if="!showReadyButton" class="flex-1" aria-hidden="true" />
      </div>
    </template>
    <template #right>
      <LivePreview
        ref="previewRef"
        :html="tinkerHtml"
        :css="tinkerCss"
        :mode="isReadmeStep ? 'readme' : 'html'"
        :readme-content="tinkerReadme"
        :linking-enabled="!isReadmeStep"
        :require-css-link="stepData.tinker.showCssEditor"
        @element-click="onElementClick"
      />
    </template>
  </PhaseLayout>
</template>

<style scoped>
.challenge-banner {
  transition: background-color 0.3s ease, color 0.3s ease;
  animation: banner-slide-in 0.4s ease-out;
}

@keyframes banner-slide-in {
  0% {
    opacity: 0;
    transform: translateY(-100%);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.ready-fade-enter-active {
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
.ready-fade-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
.ready-fade-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.ready-fade-leave-active {
  transition: opacity 0.15s ease-in;
}
.ready-fade-leave-to {
  opacity: 0;
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
