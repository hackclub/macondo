<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { X, Sparkles, LifeBuoy, Code, Wrench, Package, BookOpen, FolderKanban, Coins, ArrowRight, ArrowLeft } from "lucide-vue-next";
import WoodFrame from "./WoodFrame.vue";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useFocusTrap } from "~/composables/useFocusTrap";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

const emit = defineEmits<{
  close: [];
}>();

const props = defineProps<{
  open: boolean;
}>();

const { t } = useI18n();

const dialogEl = ref<HTMLElement | null>(null);
useEscapeClose(() => props.open, () => emit("close"));
useFocusTrap(() => props.open, dialogEl);

type Pose = "talking_normal" | "thinking" | "thinking_happy" | "thinking_happy_2" | "thinking_excited";

const POSE_SRC: Record<Pose, string> = {
  talking_normal: "/images/orpheus/orpheus_talking_normal.webp",
  thinking: "/images/orpheus/orpheus_thinking.webp",
  thinking_happy: "/images/orpheus/orpheus_thinking_happy.webp",
  thinking_happy_2: "/images/orpheus/orpheus_thinking_happy_2.webp",
  thinking_excited: "/images/orpheus/orpheus_thinking_excited.webp",
};

type Highlight = string | string[] | "all" | null;

type Step = {
  pose: Pose;
  textKey: string;
  highlight: Highlight;
  wobble?: boolean;
  expandedSection?: string;
};

const steps: Step[] = [
  { pose: "talking_normal",    textKey: "docs_intro.step_stumble",  highlight: null,                          wobble: true },
  { pose: "thinking_happy",    textKey: "docs_intro.step_hi",       highlight: null },
  { pose: "talking_normal",    textKey: "docs_intro.step_overview", highlight: "all" },
  { pose: "thinking_happy",    textKey: "docs_intro.step_start",    highlight: "start",                       expandedSection: "start" },
  { pose: "thinking",          textKey: "docs_intro.step_tech",     highlight: ["software", "hardware"] },
  { pose: "thinking_happy",    textKey: "docs_intro.step_guides",   highlight: "guides" },
  { pose: "talking_normal",    textKey: "docs_intro.step_redeem",   highlight: ["shipping", "project"] },
  { pose: "thinking_excited",  textKey: "docs_intro.step_fruits",   highlight: "currency" },
  { pose: "thinking_happy_2",  textKey: "docs_intro.step_bye",      highlight: null },
];

const stepIndex = ref(0);
const totalSteps = steps.length;
const currentStep = computed(() => steps[stepIndex.value]!);

const sections = [
  { key: "start",     icon: Sparkles },
  { key: "project",   icon: FolderKanban },
  { key: "software",  icon: Code },
  { key: "hardware",  icon: Wrench },
  { key: "guides",    icon: BookOpen },
  { key: "shipping",  icon: Package },
  { key: "currency",  icon: Coins },
  { key: "help",      icon: LifeBuoy },
];

const subpagesByKey: Record<string, { titleKey: string; active?: boolean }[]> = {
  start: [
    { titleKey: "docs_intro.start_page_1", active: true },
    { titleKey: "docs_intro.start_page_2" },
  ],
};

function subpagesFor(key: string) {
  return subpagesByKey[key] ?? [];
}

function isHighlighted(key: string): boolean {
  const h = currentStep.value.highlight;
  if (h === null) return false;
  if (h === "all") return true;
  if (Array.isArray(h)) return h.includes(key);
  return h === key;
}

const displayedText = ref("");
const isTyping = ref(false);
let typingInterval: ReturnType<typeof setInterval> | null = null;

function clearTypingInterval() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

function startTyping() {
  clearTypingInterval();
  const fullText = t(currentStep.value.textKey);
  displayedText.value = "";
  isTyping.value = true;
  let i = 0;
  typingInterval = setInterval(() => {
    if (i < fullText.length) {
      displayedText.value = fullText.slice(0, i + 1);
      i++;
    } else {
      clearTypingInterval();
      isTyping.value = false;
    }
  }, 28); // ms per char, a bit faster than StorylinePlayer
}

function skipTyping() {
  clearTypingInterval();
  displayedText.value = t(currentStep.value.textKey);
  isTyping.value = false;
}

watch(stepIndex, () => {
  nextTick(() => startTyping());
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      stepIndex.value = 0;
      nextTick(() => startTyping());
    } else {
      clearTypingInterval();
      displayedText.value = "";
      isTyping.value = false;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTypingInterval());

function next() {
  // First click finishes typing, second advances, so readers don't skip unread steps.
  if (isTyping.value) {
    skipTyping();
    return;
  }
  if (stepIndex.value < totalSteps - 1) {
    stepIndex.value++;
  } else {
    emit("close");
  }
}

function back() {
  if (stepIndex.value > 0) stepIndex.value--;
}

function skipAll() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
        @click="skipAll"
      />
    </Transition>
    <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
      <div
        v-if="open"
        ref="dialogEl"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('docs_intro.dialog_label')"
        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none p-3 sm:p-4"
      >
        <WoodFrame class="w-full max-w-sm sm:max-w-xl md:max-w-2xl pointer-events-auto">
          <div class="p-4 sm:p-6 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-1.5">
                <span
                  v-for="(_, i) in steps"
                  :key="i"
                  class="h-1.5 rounded-full transition-all duration-300"
                  :class="i === stepIndex
                    ? 'w-6 bg-ds-brown'
                    : i < stepIndex
                      ? 'w-3 bg-ds-brown/60'
                      : 'w-3 bg-ds-brown/20'"
                />
              </div>
              <button
                class="text-ds-brown/50 hover:text-ds-brown transition-colors"
                :aria-label="$t('common.close')"
                @click="skipAll"
              >
                <X :size="20" />
              </button>
            </div>

            <div class="flex flex-col sm:flex-row gap-4 sm:gap-5 items-stretch">
              <div class="flex flex-col items-center sm:items-start sm:w-[45%] gap-3">
                <div
                  :key="stepIndex"
                  class="orpheus-wrap flex justify-center sm:justify-start"
                  :class="{ 'orpheus-wobble': currentStep.wobble }"
                >
                  <img
                    :src="POSE_SRC[currentStep.pose]"
                    :alt="$t('docs_intro.orpheus_alt')"
                    class="w-24 sm:w-32 md:w-36 h-auto select-none pointer-events-none"
                    draggable="false"
                  >
                </div>

                <div
                  class="speech-bubble relative border-[3px] border-ds-brown bg-white/90 px-3 py-2.5 sm:px-4 sm:py-3 text-ds-brown text-sm sm:text-base leading-snug font-medium w-full cursor-pointer select-none"
                  :aria-live="isTyping ? 'polite' : undefined"
                  @click="skipTyping"
                >
                  <p class="min-h-[3em]">
                    {{ displayedText }}<span
                      v-if="isTyping"
                      class="typewriter-cursor"
                      aria-hidden="true"
                    >▊</span>
                  </p>
                </div>
              </div>

              <div class="flex-1 min-w-0">
                <div class="border-[3px] border-ds-brown/30 bg-parchment/70 p-2 sm:p-3">
                  <div class="text-[10px] sm:text-xs font-bold text-ds-brown/50 uppercase tracking-widest mb-2 px-1">
                    {{ $t("docs_nav.sections_label") }}
                  </div>
                  <div class="flex flex-col gap-1">
                    <div v-for="section in sections" :key="section.key" class="flex flex-col">
                      <div
                        class="tour-section flex items-center gap-2 border-[2px] px-2 py-1.5 transition-all duration-300"
                        :class="isHighlighted(section.key)
                          ? 'tour-section-active border-ds-brown bg-ds-brown/15'
                          : 'border-ds-brown/15 bg-white/40'"
                      >
                        <component :is="section.icon" :size="14" class="text-ds-brown shrink-0" />
                        <span class="text-[11px] sm:text-xs font-bold text-ds-brown truncate uppercase tracking-wide">
                          {{ $t(`docs_nav.${section.key}`) }}
                        </span>
                        <svg
                          class="ml-auto shrink-0 transition-transform duration-300"
                          :class="[
                            section.key === currentStep.expandedSection ? 'rotate-90 text-ds-brown' : 'text-ds-brown/40',
                            isHighlighted(section.key) && section.key !== currentStep.expandedSection && currentStep.highlight !== 'all'
                              ? 'tour-arrow text-ds-brown'
                              : '',
                          ]"
                          width="14" height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>

                      <Transition name="unfurl">
                        <div
                          v-if="section.key === currentStep.expandedSection && subpagesFor(section.key).length > 0"
                          class="unfurl-group overflow-hidden"
                        >
                          <div class="flex flex-col gap-0.5 pt-1 pl-2">
                            <div
                              v-for="sp in subpagesFor(section.key)"
                              :key="sp.titleKey"
                              class="tour-subpage flex items-center gap-2 pl-3 pr-2 py-1.5 text-[11px] sm:text-xs transition-all"
                              :class="sp.active
                                ? 'text-ds-brown font-bold bg-ds-brown/5 border-l-[3px] border-ds-brown -ml-[3px]'
                                : 'text-ds-brown/60 border-l-[3px] border-transparent -ml-[3px]'"
                            >
                              <span
                                class="w-1.5 h-1.5 rounded-full shrink-0"
                                :class="sp.active ? 'bg-ds-brown' : 'bg-ds-brown/30'"
                              />
                              <span class="truncate">{{ $t(sp.titleKey) }}</span>
                            </div>
                          </div>
                        </div>
                      </Transition>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 mt-1">
              <button
                v-if="stepIndex > 0"
                type="button"
                class="ds-btn-ghost text-sm inline-flex items-center justify-center gap-1"
                @click="back"
              >
                <ArrowLeft :size="16" />
                {{ $t("common.back") }}
              </button>
              <button
                v-else
                type="button"
                class="ds-btn-ghost text-sm"
                @click="skipAll"
              >
                {{ $t("docs_intro.skip") }}
              </button>
              <button
                type="button"
                class="flex-1 ds-btn-primary inline-flex items-center justify-center gap-1"
                @click="next"
              >
                <template v-if="stepIndex < totalSteps - 1">
                  {{ $t("common.continue") }}
                  <ArrowRight :size="16" />
                </template>
                <template v-else>
                  {{ $t("docs_intro.got_it") }}
                </template>
              </button>
            </div>
          </div>
        </WoodFrame>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>

/* The keyed wrapper replays the animation on every step change. */
.orpheus-wrap {
  animation: orpheus-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom center;
}

.orpheus-wrap.orpheus-wobble {
  animation: orpheus-stumble 0.9s ease-out;
}

@keyframes orpheus-pop {
  from { opacity: 0; transform: translateY(10px) scale(0.9); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes orpheus-stumble {
  0%   { opacity: 0; transform: translateX(-40px) rotate(-15deg); }
  30%  { opacity: 1; transform: translateX(10px)  rotate(10deg); }
  55%  { transform: translateX(-6px) rotate(-5deg); }
  80%  { transform: translateX(3px)  rotate(2deg); }
  100% { transform: translateX(0)    rotate(0); }
}

.speech-bubble::before,
.speech-bubble::after {
  content: "";
  position: absolute;
  width: 0;
  height: 0;
  left: 50%;
  transform: translateX(-50%);
  border-style: solid;
}
.speech-bubble::before {
  top: -14px;
  border-width: 0 11px 14px 11px;
  border-color: transparent transparent #684D3A transparent;
}
.speech-bubble::after {
  top: -10px;
  border-width: 0 8px 10px 8px;
  border-color: transparent transparent rgba(255, 255, 255, 0.9) transparent;
}

.typewriter-cursor {
  display: inline-block;
  margin-left: 1px;
  color: #684D3A;
  animation: typewriter-blink 0.9s steps(2, start) infinite;
}

@keyframes typewriter-blink {
  50% { opacity: 0; }
}

.tour-section-active {
  animation: tour-pulse 1.4s ease-in-out infinite;
}

@keyframes tour-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(104, 77, 58, 0.45);
    transform: translateX(0);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(104, 77, 58, 0);
    transform: translateX(2px);
  }
}

.tour-arrow {
  animation: tour-arrow-nudge 0.9s ease-in-out infinite;
}

@keyframes tour-arrow-nudge {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(3px); }
}

.unfurl-enter-from,
.unfurl-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}
.unfurl-enter-to,
.unfurl-leave-from {
  max-height: 200px;
  opacity: 1;
  transform: translateY(0);
}
.unfurl-enter-active {
  transition:
    max-height 0.4s cubic-bezier(0.22, 1.2, 0.36, 1),
    opacity 0.25s ease 0.08s,
    transform 0.35s ease;
}
.unfurl-leave-active {
  transition:
    max-height 0.25s ease-in,
    opacity 0.15s ease,
    transform 0.2s ease;
}

.tour-subpage {
  animation: tour-subpage-in 0.35s ease-out both;
}
.unfurl-group .tour-subpage:nth-child(1) { animation-delay: 0.12s; }
.unfurl-group .tour-subpage:nth-child(2) { animation-delay: 0.2s; }
.unfurl-group .tour-subpage:nth-child(3) { animation-delay: 0.28s; }

@keyframes tour-subpage-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .orpheus-wrap,
  .orpheus-wrap.orpheus-wobble,
  .tour-section-active,
  .tour-arrow,
  .typewriter-cursor,
  .tour-subpage {
    animation: none;
  }
  .unfurl-enter-active,
  .unfurl-leave-active {
    transition: opacity 0.15s ease;
  }
  .unfurl-enter-from,
  .unfurl-leave-to {
    max-height: 200px;
    transform: none;
  }
}
</style>
