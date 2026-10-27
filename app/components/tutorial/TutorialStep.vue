<script setup lang="ts">
import { tutorialSteps } from '~/data/tutorialStepData';
import PhaseGoal from '~/components/tutorial/PhaseGoal.vue';
import PhaseTinker from '~/components/tutorial/PhaseTinker.vue';
import PhaseExplain from '~/components/tutorial/PhaseExplain.vue';
import PhaseApply from '~/components/tutorial/PhaseApply.vue';
import Notebook from '~/components/tutorial/Notebook.vue';
import LanguageSwitcher from '~/components/LanguageSwitcher.vue';
import { BookOpen, Home, RotateCcw } from 'lucide-vue-next';
import { useEscapeClose } from '~/composables/useEscapeClose';

// Lets the mobile inline trigger call openNotebook()
const notebookRef = ref<InstanceType<typeof Notebook> | null>(null);

const isDev = import.meta.dev;

const props = defineProps<{
  stepIndex: number;
  initialPhase: 'goal' | 'tinker' | 'explain' | 'apply';
  userCode: { html: string; css: string; readme: string };
  tinkerCode?: { html: string; css: string; readme: string };
  tinkerChallengesCompleted?: number[];
  isRevisiting?: boolean;
  // Suppresses Escape-to-farm while a child (e.g. the reward modal) handles Escape itself
  disableEscape?: boolean;
  externalError?: string;
}>();
const emit = defineEmits<{
  complete: [userCode: { html: string; css: string; readme: string }];
  save: [data: Record<string, unknown>];
  back: [];
  backToFarm: [];
  resetStep: [];
  clearExternalError: [];
}>();

const stepData = computed(() => tutorialSteps[props.stepIndex]);

const { t: tc, te: tce } = useI18n();
function localizeStepField(
  field: 'title' | 'goal_description' | 'explain_content' | 'apply_instructions',
  fallback: string,
): string {
  const key = `tutorial_content.${stepData.value.id}.${field}`;
  return tce(key) ? tc(key) : fallback;
}

const localizedTitle = computed(() => localizeStepField('title', stepData.value.title));
const localizedGoalDescription = computed(() =>
  localizeStepField('goal_description', stepData.value.goal.description),
);
const localizedExplainContent = computed(() =>
  localizeStepField('explain_content', stepData.value.explain.content),
);
const localizedApplyInstructions = computed(() =>
  localizeStepField('apply_instructions', stepData.value.apply.instructions || ''),
);

const currentPhase = ref<'goal' | 'tinker' | 'explain' | 'apply'>(props.initialPhase);

const localTinkerCode = ref<{ html: string; css: string; readme: string }>(
  props.tinkerCode
    ? { ...props.tinkerCode }
    : { html: '', css: '', readme: '' }
);

watch(() => props.stepIndex, () => {
  currentPhase.value = props.initialPhase;
  localTinkerCode.value = props.tinkerCode
    ? { ...props.tinkerCode }
    : { html: '', css: '', readme: '' };
  localChallengesCompleted.value = props.tinkerChallengesCompleted
    ? [...props.tinkerChallengesCompleted]
    : [];
});

const localChallengesCompleted = ref<number[]>(
  props.tinkerChallengesCompleted ? [...props.tinkerChallengesCompleted] : []
);

function emitSave() {
  emit('save', {
    tutorialPhase: currentPhase.value,
    tinkerCode: localTinkerCode.value,
    tinkerChallengesCompleted: localChallengesCompleted.value,
  });
}

function onGoalReady() {
  // Skip tinker when there are no challenges (e.g. README), and explain too if it's empty
  if (stepData.value.tinker.challenges.length === 0) {
    currentPhase.value = stepData.value.explain.content ? 'explain' : 'apply';
  } else {
    currentPhase.value = 'tinker';
  }
  emitSave();
}

function onTinkerReady() {
  currentPhase.value = 'explain';
  emitSave();
}

function onTinkerSave(code: { html: string; css: string; readme: string }, challenges: number[]) {
  localTinkerCode.value = code;
  localChallengesCompleted.value = challenges;
  emitSave();
}

function onExplainReady() {
  currentPhase.value = 'apply';
  emitSave();
}

function onApplyComplete(code: { html: string; css: string; readme: string }) {
  emit('complete', code);
}

function onApplyBack() {
  // Tinker is skipped on steps without challenges, so go back to explain or goal
  if (stepData.value.explain.content) {
    currentPhase.value = 'explain';
  } else {
    currentPhase.value = 'goal';
  }
  emitSave();
}

function onApplySave(code: { html: string; css: string; readme: string }) {
  emit('save', {
    tutorialPhase: currentPhase.value,
    tinkerCode: localTinkerCode.value,
    tinkerChallengesCompleted: localChallengesCompleted.value,
    userCode: code,
  });
}

const phaseOrder: ('goal' | 'tinker' | 'explain' | 'apply')[] = ['goal', 'tinker', 'explain', 'apply'];

function handleGlobalBack() {
  const currentIdx = phaseOrder.indexOf(currentPhase.value);

  if (currentIdx > 0) {
    // Skip phases this step doesn't have
    let targetIdx = currentIdx - 1;
    while (targetIdx >= 0) {
      const phase = phaseOrder[targetIdx]!;
      if (phase === 'goal') { currentPhase.value = 'goal'; break; }
      if (phase === 'tinker' && stepData.value.tinker.challenges.length > 0) { currentPhase.value = 'tinker'; break; }
      if (phase === 'explain' && stepData.value.explain.content) { currentPhase.value = 'explain'; break; }
      targetIdx--;
    }
    if (targetIdx < 0) currentPhase.value = 'goal';
    emitSave();
  } else {
    emit('back');
  }
}

const canGoBack = computed(() => {
  return props.stepIndex > 0 || currentPhase.value !== 'goal';
});

// Escape exits to the farm; that handler saves progress, so it's non-destructive
useEscapeClose(
  () => !props.disableEscape,
  () => emit('backToFarm'),
);
</script>

<template>
  <div class="h-full flex flex-col relative">
    <div class="px-6 pt-3 pb-0 border-b-[3px] border-ds-brown bg-ds-brown flex flex-col gap-3">
      <div class="flex items-center gap-4">
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-bold mb-1 text-ds-cream">{{ $t("tutorial_step.build_website") }}</h2>
          <p class="text-sm text-ds-cream/50">{{ $t("tutorial_step.step_of", { current: stepIndex + 1, total: tutorialSteps.length, title: localizedTitle }) }}</p>
        </div>

        <!-- Dev-only: lets a reviewer re-test the tinker challenges without a fresh account -->
        <button
          v-if="isDev"
          class="ds-btn-primary-inverted flex items-center gap-1.5 shrink-0"
          title="DEV: Reset this step's cached progress"
          @click="emit('resetStep')"
        >
          <RotateCcw :size="16" />
          <span class="hidden sm:inline">{{ $t("tutorial_step.reset_step") }}</span>
        </button>

        <!-- Exits without completing, so the tutorial can be resumed from the project page -->
        <button
          class="ds-btn-primary-inverted flex items-center gap-1.5 shrink-0"
          :title="$t('tutorial_step.back_to_farm_title')"
          @click="emit('backToFarm')"
        >
          <Home :size="16" />
          <span class="hidden sm:inline">{{ $t("tutorial_step.back_to_farm") }}</span>
        </button>
      </div>

      <div class="flex gap-1 pb-3">
        <div
          v-for="(_, i) in tutorialSteps.length"
          :key="i"
          class="h-1.5 flex-1"
          :class="i <= stepIndex ? 'bg-ds-cream' : 'bg-ds-cream/20'"
        />
      </div>
    </div>

    <!-- Inline on mobile, where the floating versions would cover the phase footer -->
    <div class="md:hidden flex items-center justify-end gap-2 px-4 py-2 border-b border-ds-brown/10 bg-parchment shrink-0">
      <LanguageSwitcher :drop-up="false" />
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 bg-ds-brown text-ds-cream text-xs font-bold border-[3px] border-ds-brown hover:bg-ds-brown/90 transition-colors"
        @click="notebookRef?.openNotebook()"
      >
        <BookOpen :size="14" />
        {{ $t("notebook.heading") }}
      </button>
    </div>

    <!-- Always rendered: a step 0 tinker challenge asks the learner to open it -->
    <Notebook ref="notebookRef" :step-index="stepIndex" :phase="currentPhase" />

    <div class="flex-1 min-h-0">
      <Transition name="fade" mode="out-in">
        <PhaseGoal
          v-if="currentPhase === 'goal'"
          :key="'goal'"
          :description="localizedGoalDescription"
          :preview-code="stepData.goal.previewCode"
          :is-readme="stepData.id === 'readme'"
          :can-go-back="canGoBack"
          @ready="onGoalReady"
          @back="handleGlobalBack"
        />
        <PhaseTinker
          v-else-if="currentPhase === 'tinker'"
          :key="'tinker'"
          :step-data="stepData"
          :initial-code="localTinkerCode"
          :initial-challenges-completed="localChallengesCompleted"
          :user-code="props.userCode"
          :can-go-back="canGoBack"
          :is-revisiting="props.isRevisiting"
          @ready="onTinkerReady"
          @back="handleGlobalBack"
          @save="onTinkerSave"
        />
        <PhaseExplain
          v-else-if="currentPhase === 'explain'"
          :key="'explain'"
          :content="localizedExplainContent"
          :snippets="stepData.explain.snippets"
          :learn-more-links="stepData.explain.learnMoreLinks"
          :preview-code="stepData.goal.previewCode"
          :is-readme="stepData.id === 'readme'"
          :can-go-back="canGoBack"
          @ready="onExplainReady"
          @back="handleGlobalBack"
        />
        <PhaseApply
          v-else-if="currentPhase === 'apply'"
          :key="'apply'"
          :step-data="stepData"
          :localized-instructions="localizedApplyInstructions"
          :user-code="userCode"
          :is-first-step="stepIndex === 0"
          :is-last-step="stepIndex === tutorialSteps.length - 1"
          :can-go-back="canGoBack"
          :is-revisiting="props.isRevisiting"
          :external-error="props.externalError"
          @complete="onApplyComplete"
          @back="onApplyBack"
          @save="onApplySave"
          @clear-external-error="emit('clearExternalError')"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
