<script setup lang="ts">
import type { StoryScene } from "~/data/storylineData";
import { orpheusSpriteMap } from "~/data/storylineData";

const props = defineProps<{
  scenes: StoryScene[];
  bareMode?: boolean;
}>();

const emit = defineEmits<{
  complete: [];
  choice: [value: string];
}>();

const { locale } = useI18n();

const currentIndex = ref(0);
const displayedText = ref("");
const isTyping = ref(false);
const isTransitioning = ref(false);
const showScene = ref(true);
const typingInterval = ref<ReturnType<typeof setInterval> | null>(null);

const scene = computed(() => props.scenes[currentIndex.value]);
const fadeMs = 600;

const activeText = computed(() => {
  const s = scene.value;
  if (!s) return "";
  return (locale.value === "es" ? s.textEs : s.text) ?? "";
});

const activeChoices = computed(() => {
  const s = scene.value;
  if (!s?.choices) return [];
  if (locale.value === "es") {
    if (!s.choicesEs) {
      // choices implies choicesEs; fail loud so a missing translation surfaces
      console.error(`[StorylinePlayer] scene "${s.id}" has choices but no choicesEs`);
      return s.choices;
    }
    return s.choicesEs;
  }
  return s.choices;
});

// stable key so the background only re-fades when it actually changes
const bgKey = computed(() => {
  const s = scene.value;
  if (s?.useGameWorld) return 'gameworld';
  if (s?.background) return s.background;
  return 'black';
});

const spriteSrc = computed(() => {
  const s = scene.value;
  if (s?.sprite && orpheusSpriteMap[s.sprite]) {
    return orpheusSpriteMap[s.sprite];
  }
  return isTyping.value
    ? "/images/textbox/sprites/idle.webp"
    : "/images/textbox/sprites/smiling.webp";
});

function startTyping() {
  const text = activeText.value;
  if (!text) {
    displayedText.value = "";
    isTyping.value = false;
    return;
  }
  displayedText.value = "";
  isTyping.value = true;
  let i = 0;
  typingInterval.value = setInterval(() => {
    if (i < text.length) {
      displayedText.value += text[i];
      i++;
    } else {
      clearTyping();
    }
  }, 35); // ms per character
}

function clearTyping() {
  if (typingInterval.value) {
    clearInterval(typingInterval.value);
    typingInterval.value = null;
  }
  isTyping.value = false;
}

function skipOrAdvance() {
  if (isTransitioning.value) return;
  if (scene.value?.type === "choice" && !isTyping.value) return;

  if (isTyping.value) {
    clearTyping();
    displayedText.value = activeText.value;
  } else {
    advanceScene();
  }
}

const isFadingOut = ref(false);

function advanceScene() {
  if (currentIndex.value >= props.scenes.length - 1) {
    isFadingOut.value = true;
    isTransitioning.value = true;
    showScene.value = false;
    setTimeout(() => {
      emit("complete");
    }, fadeMs);
    return;
  }

  const current = props.scenes[currentIndex.value];
  const next = props.scenes[currentIndex.value + 1];
  const sameBackground =
    current?.useGameWorld && next?.useGameWorld ||
    (!current?.useGameWorld && !next?.useGameWorld && current?.background === next?.background);

  if (sameBackground) {
    // content fades via the Transition keyed on currentIndex
    currentIndex.value++;
    displayedText.value = "";
    nextTick(() => startTyping());
  } else {
    isTransitioning.value = true;
    showScene.value = false;
    setTimeout(() => {
      currentIndex.value++;
      displayedText.value = "";
      showScene.value = true;
      isTransitioning.value = false;
      nextTick(() => startTyping());
    }, fadeMs);
  }
}

function handleChoice(value: string) {
  emit("choice", value);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === "Space") {
    e.preventDefault();
    skipOrAdvance();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  startTyping();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  clearTyping();
});

// restart typing on a locale flip so a line isn't half one language, half the other
watch(locale, () => {
  if (!scene.value) return;
  clearTyping();
  startTyping();
});
</script>

<template>
  <div
    class="storyline-root"
    :class="{ 'storyline-fade-out': isFadingOut }"
    :style="{ background: scene?.useGameWorld ? 'transparent' : '#000' }"
    @click="skipOrAdvance"
  >
    <Transition name="story-fade">
      <div v-if="showScene" :key="bgKey" class="storyline-bg">
        <GameWorld
          v-if="scene?.useGameWorld"
          :highlight-element="scene.highlight || null"
          :bare-mode="bareMode"
          :show-docs-hint="true"
        />
        <img
          v-else-if="scene?.background"
          :src="scene.background"
          class="storyline-bg-img"
          alt=""
        >
        <div v-else class="storyline-bg-black" />
      </div>
    </Transition>

    <Transition name="story-fade">
    <div v-if="showScene" :key="currentIndex" class="storyline-content">
        <template v-if="scene?.display === 'centered'">
          <div class="storyline-centered" :class="{ 'storyline-backdrop': scene.type === 'choice' }">
            <template v-if="scene.type === 'choice'">
              <WoodFrame class="storyline-modal">
                <div class="p-5 sm:p-7 flex flex-col gap-5">
                  <div class="flex items-end gap-4">
                    <img
                      v-if="scene.sprite"
                      :src="orpheusSpriteMap[scene.sprite]"
                      class="w-24 sm:w-32 h-auto object-contain shrink-0 choice-orpheus"
                      alt=""
                      draggable="false"
                    >
                    <div
                      class="choice-speech relative flex-1 border-[3px] border-ds-brown bg-white/90 px-4 py-3 text-ds-brown text-sm sm:text-base leading-snug font-medium cursor-pointer select-none"
                      :aria-live="isTyping ? 'polite' : undefined"
                      @click.stop="skipOrAdvance"
                    >
                      <p class="min-h-[2.5em]">
                        {{ displayedText }}<span
                          v-if="isTyping"
                          class="choice-cursor"
                          aria-hidden="true"
                        >▊</span>
                      </p>
                    </div>
                  </div>
                  <div v-if="!isTyping" class="flex flex-col sm:flex-row gap-3 w-full">
                    <button
                      v-for="choice in activeChoices"
                      :key="choice.value"
                      class="storyline-choice-btn flex-1 w-full"
                      @click.stop="handleChoice(choice.value)"
                    >
                      {{ choice.label }}
                    </button>
                  </div>
                </div>
              </WoodFrame>
            </template>
            <template v-else>
              <p v-if="scene.text" class="storyline-centered-text font-satoro">
                {{ displayedText }}
              </p>
              <p class="storyline-centered-hint" :class="isTyping ? 'storyline-hint-hidden' : ''">
                {{ $t("storyline.press_space_or_click") }}
              </p>
            </template>
          </div>
        </template>

        <template v-else-if="scene?.display === 'textbox'">
          <div class="storyline-textbox-wrapper" :class="scene.textboxPosition === 'top' ? 'storyline-textbox-top' : ''">
            <div class="storyline-textbox">
              <div class="portrait-outer">
                <div class="portrait-inner">
                  <img
                    :src="spriteSrc"
                    class="portrait-sprite"
                    alt=""
                  >
                </div>
              </div>
              <div class="textbox-body">
                <p class="textbox-text">{{ displayedText }}</p>
              </div>
            </div>
            <p v-if="scene?.type !== 'choice'" class="storyline-hint" :class="isTyping ? 'storyline-hint-hidden' : ''">
              {{ $t("storyline.press_space_or_click") }}
            </p>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.storyline-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
  animation: storyline-fade-in 0.6s ease;
}

@keyframes storyline-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.storyline-fade-out {
  animation: storyline-fade-out 0.6s ease forwards;
}

@keyframes storyline-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

.storyline-bg {
  position: absolute;
  inset: 0;
}

.storyline-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.storyline-bg-black {
  width: 100%;
  height: 100%;
  background: #000;
}

/* must sit above GameWorld's .full-page-dim (15) and .highlighted targets (20) */
.storyline-content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.storyline-centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  max-width: 700px;
  text-align: center;
}

.storyline-backdrop {
  position: fixed;
  inset: 0;
  max-width: none;
  width: 100%;
  padding: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.storyline-modal {
  width: min(90vw, 780px);
}

.storyline-centered-text {
  color: #fff;
  font-size: clamp(1.25rem, 2.4vw, 2.5rem);
  line-height: 1.6;
  letter-spacing: 0.02em;
  white-space: pre-line;
}

.storyline-centered-hint {
  margin-top: 2rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.875rem;
  letter-spacing: 0.05em;
  transition: opacity 0.3s ease;
}

.choice-orpheus {
  animation: choice-orpheus-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom center;
}
@keyframes choice-orpheus-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.92); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.choice-speech::before,
.choice-speech::after {
  content: "";
  position: absolute;
  width: 0;
  height: 0;
  top: 50%;
  transform: translateY(-50%);
  border-style: solid;
}
.choice-speech::before {
  left: -14px;
  border-width: 11px 14px 11px 0;
  border-color: transparent #684D3A transparent transparent;
}
.choice-speech::after {
  left: -10px;
  border-width: 8px 10px 8px 0;
  border-color: transparent rgba(255, 255, 255, 0.9) transparent transparent;
}

.choice-cursor {
  display: inline-block;
  margin-left: 1px;
  color: #684D3A;
  animation: choice-cursor-blink 0.9s steps(2, start) infinite;
}
@keyframes choice-cursor-blink {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .choice-orpheus,
  .choice-cursor { animation: none; }
}

.storyline-choice-btn {
  padding: 0.75rem 2rem;
  background: #684D3A;
  border: 3px solid #684D3A;
  border-radius: 0;
  color: #F6E5C7;
  font-size: 1rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.storyline-choice-btn:hover {
  background: #F6E5C7;
  color: #684D3A;
  border-color: #F6E5C7;
}

.storyline-textbox-wrapper {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 1200px);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.storyline-textbox-wrapper.storyline-textbox-top {
  bottom: auto;
  top: 6rem;
}

.storyline-textbox {
  position: relative;
  width: 100%;
  min-height: 140px;
}

.portrait-outer {
  position: absolute;
  left: -60px;
  bottom: 0;
  flex-shrink: 0;
  width: 180px;
  height: 190px;
  background: transparent;
  border: 2.5px solid #644D2D;
  z-index: 2;
}

.portrait-inner {
  position: absolute;
  inset: 10px;
  border: 2.5px solid #644D2D;
  background: #23232C;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.portrait-sprite {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.textbox-body {
  width: 100%;
  background: #23232C;
  border: 2.5px solid #644D2D;
  display: flex;
  align-items: center;
  padding: 1rem 1.25rem 1rem 150px;
  min-height: 140px;
}

.textbox-text {
  color: #fff;
  font-family: 'Acme', sans-serif;
  font-size: clamp(0.9rem, 1.4vw, 1.4rem);
  line-height: 1.5;
  margin: 0;
}

@media (min-width: 1200px) {
  .portrait-outer {
    width: 230px;
    height: 240px;
  }
  .textbox-body {
    padding-left: 190px;
    min-height: 170px;
  }
}

.storyline-hint {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.75rem;
  margin-top: 0.5rem;
  opacity: 1;
  transition: opacity 0.3s ease;
  animation: hint-pulse 2s ease-in-out infinite;
}

.storyline-hint-hidden {
  opacity: 0;
  animation: none;
}

@keyframes hint-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.story-fade-enter-active,
.story-fade-leave-active {
  transition: opacity 0.6s ease;
}

.story-fade-enter-from,
.story-fade-leave-to {
  opacity: 0;
}
</style>
