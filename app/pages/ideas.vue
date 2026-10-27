<script setup lang="ts">
import { Check, ChevronRight, ExternalLink, Sparkles } from "lucide-vue-next";
import { BEGINNER_WORKSHOPS, WORKSHOPS_INDEX_URL } from "~/data/beginnerWorkshops";

definePageMeta({ layout: false });

const props = defineProps<{
  embeddedWindowed?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

// Idea Box disabled to stop AI-credit usage; to restore, flip this and re-add the dashboard
// entry points (button, "i" shortcut, ?ideas handler, embedded modal).
const IDEA_BOX_DISABLED: boolean = true;

type IdeaStatus = "suggested" | "saved" | "dismissed";
type IdeaDifficulty = "beginner" | "intermediate" | "advanced" | "expert";
type IdeaKind = "new_project" | "project_update";
type IdeaCategory = "software" | "hardware";

interface IdeaResource {
  title: string;
  url: string;
}

interface Idea {
  id: number;
  user_id: string;
  title: string;
  description: string;
  reasoning: string | null;
  languages: string[];
  difficulty: IdeaDifficulty | null;
  kind: IdeaKind;
  category: IdeaCategory;
  existing_project_id: number | null;
  existing_project_name: string | null;
  status: IdeaStatus;
  resources: IdeaResource[];
}

interface ListResponse {
  current: Idea | null;
  saved: Idea[];
  hasHackatimeToken: boolean;
}

interface RerollResponse {
  idea: Idea | null;
  ideas: Idea[];
}

const { t } = useI18n();
const route = useRoute();
const isWindowed = computed(() => props.embeddedWindowed || route.query.windowed === "1");

function closeModal() {
  if (props.embeddedWindowed) emit("close");
}

const current = ref<Idea | null>(null);
const saved = ref<Idea[]>([]);
const hasHackatimeToken = ref(true);
const loading = ref(true);
const rerolling = ref(false);
const acting = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const category = ref<IdeaCategory>("software");
type DifficultyChoice = "auto" | IdeaDifficulty;
const difficultyChoice = ref<DifficultyChoice>("auto");
// rolls ignore the user's projects and Hackatime activity; total hours still set the difficulty.
const ignoreHistory = ref(false);
const showSaved = ref(false);

// a monotonic token aborts every typewriter loop at its next await when current changes,
// so a fresh idea never gets characters from the previous one.
const typedTitle = ref("");
const typedDescription = ref("");
const typedReasoning = ref("");
const titleTyping = ref(false);
const descriptionTyping = ref(false);
const reasoningTyping = ref(false);
const typewriterTimers = new Set<ReturnType<typeof setTimeout>>();
let typewriterToken = 0;

function clearTypewriter() {
  for (const t of typewriterTimers) clearTimeout(t);
  typewriterTimers.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      typewriterTimers.delete(t);
      resolve();
    }, ms);
    typewriterTimers.add(t);
  });
}

async function typeField(
  text: string,
  perChar: number,
  startDelay: number,
  myToken: number,
  setText: (v: string) => void,
  setTyping: (v: boolean) => void,
) {
  if (startDelay > 0) await sleep(startDelay);
  if (myToken !== typewriterToken) return;
  setTyping(true);
  for (let i = 1; i <= text.length; i++) {
    if (myToken !== typewriterToken) return;
    setText(text.slice(0, i));
    await sleep(perChar);
  }
  if (myToken !== typewriterToken) return;
  setTyping(false);
}

async function typeOutSequence(idea: Idea) {
  clearTypewriter();
  const myToken = ++typewriterToken;
  typedTitle.value = "";
  typedDescription.value = "";
  typedReasoning.value = "";
  titleTyping.value = false;
  descriptionTyping.value = false;
  reasoningTyping.value = false;

  // staggered starts, but run in parallel so the card fills in about the longest field's time.
  await Promise.all([
    typeField(idea.title, 15, 0, myToken, (v) => (typedTitle.value = v), (v) => (titleTyping.value = v)), // 15ms per char, no start delay
    typeField(idea.description, 6, 220, myToken, (v) => (typedDescription.value = v), (v) => (descriptionTyping.value = v)), // 6ms per char, starts after 220ms
    idea.reasoning
      ? typeField(idea.reasoning, 8, 440, myToken, (v) => (typedReasoning.value = v), (v) => (reasoningTyping.value = v)) // 8ms per char, starts after 440ms
      : Promise.resolve(),
  ]);
}

watch(current, (idea) => {
  if (idea) {
    void typeOutSequence(idea);
  } else {
    clearTypewriter();
    typewriterToken++;
    typedTitle.value = "";
    typedDescription.value = "";
    typedReasoning.value = "";
    titleTyping.value = false;
    descriptionTyping.value = false;
    reasoningTyping.value = false;
  }
});

async function refresh() {
  try {
    const data = await $fetch<ListResponse>("/api/ideas");
    current.value = data.current;
    saved.value = data.saved;
    hasHackatimeToken.value = data.hasHackatimeToken;
  } catch (err) {
    console.error("[ideas] refresh failed", err);
    error.value = t("ideas.error_generic");
  } finally {
    loading.value = false;
  }
}

async function reroll() {
  // Defense in depth: never hit the AI generator while the Idea Box is off.
  if (IDEA_BOX_DISABLED) return;
  if (rerolling.value || !hasHackatimeToken.value) return;
  rerolling.value = true;
  error.value = null;
  info.value = null;
  try {
    const res = await $fetch<RerollResponse>("/api/ideas/generate", {
      method: "POST",
      body: {
        category: category.value,
        ...(difficultyChoice.value !== "auto" ? { difficulty: difficultyChoice.value } : {}),
        ...(ignoreHistory.value ? { ignoreHistory: true } : {}),
      },
    });
    // falls back to `ideas[0]` for stale server builds and the legacy mixed-batch shape.
    const next = res.idea ?? res.ideas?.[0] ?? null;
    if (next) {
      current.value = next;
    } else {
      await refresh();
    }
  } catch (err: unknown) {
    const e = err as { statusCode?: number; data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string };
    const status = e.statusCode;
    const msg = e.data?.statusMessage ?? e.data?.message ?? e.statusMessage ?? e.message ?? "";
    if (status === 422) {
      info.value = msg || t("ideas.no_activity");
    } else if (status === 400 && /hackatime/i.test(msg)) {
      hasHackatimeToken.value = false;
      info.value = t("ideas.no_hackatime_token");
    } else if (status === 403) {
      error.value = t("ideas.banned");
    } else if (status === 429) {
      info.value = t("ideas.too_fast");
    } else {
      error.value = msg || t("ideas.error_generic");
    }
  } finally {
    rerolling.value = false;
  }
}

async function saveCurrent() {
  if (!current.value || acting.value) return;
  acting.value = true;
  const idea = current.value;
  try {
    const updated = await $fetch<Idea>(`/api/ideas/${idea.id}`, {
      method: "PATCH",
      body: { action: "save" },
    });
    saved.value = [{ ...updated, existing_project_name: idea.existing_project_name }, ...saved.value];
    current.value = null;
    info.value = t("ideas.save_confirm");
  } catch (err) {
    console.error("[ideas] save failed", err);
    error.value = t("ideas.error_generic");
  } finally {
    acting.value = false;
  }
}

async function unsaveSaved(idea: Idea) {
  if (acting.value) return;
  acting.value = true;
  try {
    await $fetch(`/api/ideas/${idea.id}`, {
      method: "PATCH",
      body: { action: "unsave" },
    });
    saved.value = saved.value.filter((i) => i.id !== idea.id);
  } catch (err) {
    console.error("[ideas] unsave failed", err);
    error.value = t("ideas.error_generic");
  } finally {
    acting.value = false;
  }
}

function openExistingProject(idea: Idea) {
  if (!idea.existing_project_id) return;
  closeModal();
  navigateTo(`/dashboard?openProject=${idea.existing_project_id}`);
}

const orpheusImage = computed(() => {
  if (rerolling.value) return "/images/orpheus/orpheus_thinking.webp";
  if (!current.value) return "/images/orpheus/orpheus_thinking_happy.webp";
  return current.value.category === "hardware"
    ? "/images/orpheus/orpheus_solding.webp"
    : "/images/orpheus/orpheus_coding.webp";
});

function difficultyLabel(d: IdeaDifficulty | null): string {
  if (!d) return "";
  return t(`ideas.difficulty_${d}`);
}

const HACKATIME_LOGIN_URL = "/api/auth/hackatime/login";
const isDev = import.meta.dev;
const resetting = ref(false);

async function devReset() {
  if (resetting.value) return;
  if (!confirm(t("ideas.dev_reset_confirm"))) return;
  resetting.value = true;
  error.value = null;
  info.value = null;
  try {
    await $fetch("/api/ideas/reset", { method: "DELETE" });
    await refresh();
  } catch (err) {
    console.error("[ideas] dev reset failed", err);
    error.value = t("ideas.error_generic");
  } finally {
    resetting.value = false;
  }
}

onMounted(() => {
  if (IDEA_BOX_DISABLED) {
    loading.value = false;
    return;
  }
  void refresh();
});

onBeforeUnmount(() => {
  clearTypewriter();
});
</script>

<template>
  <div :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'" class="relative overflow-hidden">
    <div
      v-if="IDEA_BOX_DISABLED"
      :class="isWindowed ? '' : 'min-h-screen'"
      class="flex items-center justify-center px-4 py-12"
    >
      <div class="max-w-md w-full border-[3px] border-ds-brown bg-[#fffaf0] p-6 flex flex-col gap-4 text-center">
        <h1 class="text-2xl font-bold text-ds-brown">{{ $t("ideas.heading") }}</h1>
        <p class="text-sm text-ds-brown/80">{{ $t("ideas.disabled_notice") }}</p>
        <a
          v-if="isWindowed"
          href="#"
          class="ds-btn-primary self-center"
          @click.prevent="closeModal"
        >{{ $t("profile.back_to_farm") }}</a>
        <NuxtLink
          v-else
          to="/dashboard"
          class="ds-btn-primary self-center"
        >{{ $t("profile.back_to_farm") }}</NuxtLink>
      </div>
    </div>
    <div v-else class="relative z-10 max-w-3xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-4">
      <div v-if="isWindowed" class="flex items-center justify-between gap-4 w-full flex-wrap">
        <button
          class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
          @click="closeModal"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          {{ $t("profile.back_to_farm") }}
        </button>
        <a
          href="/ideas"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
        >
          {{ $t("profile.open_in_new_tab") }}
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
      <NuxtLink
        v-else
        to="/dashboard"
        class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ $t("profile.back_to_farm") }}
      </NuxtLink>

      <component :is="'div'">
        <div class="flex flex-col gap-3">
          <div class="flex items-start sm:items-center justify-between gap-3 flex-wrap">
            <h1 class="text-2xl sm:text-3xl font-bold text-ds-brown">
              {{ $t("ideas.heading") }}
            </h1>
            <div
              v-if="hasHackatimeToken"
              class="inline-flex border-[3px] border-ds-brown divide-x-[3px] divide-ds-brown"
            >
              <button
                type="button"
                class="px-3 py-1.5 text-xs sm:text-sm font-bold transition-colors"
                :class="category === 'software'
                  ? 'bg-ds-brown text-ds-cream'
                  : 'bg-transparent text-ds-brown hover:bg-ds-brown/10'"
                @click="category = 'software'"
              >
                {{ $t("ideas.category_filter_software") }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs sm:text-sm font-bold transition-colors"
                :class="category === 'hardware'
                  ? 'bg-ds-brown text-ds-cream'
                  : 'bg-transparent text-ds-brown hover:bg-ds-brown/10'"
                @click="category = 'hardware'"
              >
                {{ $t("ideas.category_filter_hardware") }}
              </button>
            </div>
          </div>

          <div
            v-if="hasHackatimeToken"
            class="flex items-center justify-between gap-2 flex-wrap"
          >
            <span class="text-[11px] font-bold text-ds-brown/60 uppercase tracking-wide">
              {{ $t("ideas.tier_label") }}
            </span>
            <div class="inline-flex border-[3px] border-ds-brown divide-x-[3px] divide-ds-brown">
              <button
                v-for="tier in (['auto', 'beginner', 'intermediate', 'advanced', 'expert'] as DifficultyChoice[])"
                :key="tier"
                type="button"
                class="px-2.5 py-1 text-[11px] sm:text-xs font-bold transition-colors"
                :class="difficultyChoice === tier
                  ? 'bg-ds-brown text-ds-cream'
                  : 'bg-transparent text-ds-brown hover:bg-ds-brown/10'"
                @click="difficultyChoice = tier"
              >
                {{ tier === 'auto' ? $t("ideas.tier_auto") : $t(`ideas.difficulty_${tier}`) }}
              </button>
            </div>
          </div>

          <button
            v-if="hasHackatimeToken"
            type="button"
            role="switch"
            :aria-checked="ignoreHistory"
            class="group flex items-start gap-2 text-left"
            @click="ignoreHistory = !ignoreHistory"
          >
            <span
              class="mt-0.5 shrink-0 w-5 h-5 border-[3px] border-ds-brown flex items-center justify-center transition-colors"
              :class="ignoreHistory ? 'bg-ds-brown' : 'bg-transparent group-hover:bg-ds-brown/10'"
            >
              <Check
                class="w-3 h-3 text-ds-cream transition-opacity"
                :class="ignoreHistory ? 'opacity-100' : 'opacity-0'"
              />
            </span>
            <span class="flex flex-col gap-0.5">
              <span class="text-xs sm:text-sm font-bold text-ds-brown">
                {{ $t("ideas.ignore_history_label") }}
              </span>
              <span class="text-[11px] text-ds-brown/60 leading-snug">
                {{ $t("ideas.ignore_history_hint") }}
              </span>
            </span>
          </button>

          <template v-if="hasHackatimeToken">
            <div
              class="relative border-[3px] border-ds-brown/40 bg-[#fffaf0] p-4 pr-24 sm:pr-28 min-h-[140px] flex flex-col gap-3 overflow-hidden"
            >
              <img
                :src="orpheusImage"
                alt=""
                class="absolute top-2 right-2 w-20 sm:w-24 object-contain select-none pointer-events-none"
                draggable="false"
              >
              <Transition name="idea-fade" mode="out-in">
                <div v-if="loading" key="loading" class="text-sm text-ds-brown/60 italic">
                  {{ $t("ideas.loading_typewriter") }}
                </div>
                <div v-else-if="rerolling" key="rerolling" class="text-sm text-ds-brown/60 italic">
                  {{ $t("ideas.rerolling") }}
                </div>
                <div v-else-if="!current" key="empty" class="text-sm text-ds-brown/60 italic">
                  {{ $t("ideas.empty_typewriter") }}
                </div>
                <div v-else :key="`idea-${current.id}`" class="flex flex-col gap-3">
                  <div class="flex items-start justify-between gap-2 flex-wrap">
                    <h2 class="flex-1 min-w-0 text-lg sm:text-xl font-bold text-ds-brown leading-snug break-words">
                      {{ typedTitle }}<span v-if="titleTyping" class="typewriter-cursor">_</span>
                    </h2>
                    <div class="flex flex-wrap items-end gap-1 shrink-0">
                      <span
                        v-if="current.kind === 'project_update'"
                        class="text-xs px-2 py-1 border-[2px] border-ds-brown bg-ds-brown text-ds-cream whitespace-nowrap"
                      >
                        {{ current.existing_project_name
                          ? $t("ideas.kind_update_for", { project: current.existing_project_name })
                          : $t("ideas.kind_update_generic") }}
                      </span>
                      <span class="text-xs px-2 py-1 border-[2px] border-ds-brown/30 bg-ds-brown/5 text-ds-brown whitespace-nowrap">
                        {{ current.category === 'hardware'
                          ? $t("ideas.category_filter_hardware")
                          : $t("ideas.category_filter_software") }}
                      </span>
                      <span
                        v-if="current.difficulty"
                        class="text-xs px-2 py-1 border-[2px] border-ds-brown/30 bg-ds-brown/5 text-ds-brown whitespace-nowrap"
                      >
                        {{ difficultyLabel(current.difficulty) }}
                      </span>
                    </div>
                  </div>

                  <p class="text-sm text-ds-brown/90 whitespace-pre-line leading-relaxed min-h-[1.25rem]">
                    {{ typedDescription }}<span v-if="descriptionTyping" class="typewriter-cursor">_</span>
                  </p>

                  <div v-if="current.reasoning" class="text-xs italic text-ds-brown/70">
                    <span class="font-bold not-italic">{{ $t("ideas.reasoning_label") }}:</span>
                    {{ typedReasoning }}<span v-if="reasoningTyping" class="typewriter-cursor">_</span>
                  </div>

                  <div
                    v-if="current.languages.length > 0 && !titleTyping && !descriptionTyping && !reasoningTyping"
                    class="flex flex-wrap gap-1.5"
                  >
                    <span
                      v-for="lang in current.languages"
                      :key="lang"
                      class="text-xs px-2 py-0.5 border-[2px] border-ds-brown/20 bg-ds-brown/5 text-ds-brown/80"
                    >
                      {{ lang }}
                    </span>
                  </div>

                  <div
                    v-if="current.resources && current.resources.length > 0 && !titleTyping && !descriptionTyping && !reasoningTyping"
                    class="flex flex-col gap-1 pt-1"
                  >
                    <span class="text-[11px] font-bold text-ds-brown/70 uppercase tracking-wide">
                      {{ $t("ideas.resources_label") }}
                    </span>
                    <ul class="flex flex-col gap-0.5">
                      <li v-for="r in current.resources" :key="r.url">
                        <a
                          :href="r.url"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="inline-flex items-center gap-1 text-xs text-ds-brown underline hover:no-underline break-words"
                        >
                          {{ r.title }}
                          <ExternalLink class="w-3 h-3 shrink-0" />
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>
              </Transition>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 border-[3px] border-ds-brown bg-ds-brown text-ds-cream text-sm font-bold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ds-brown/90"
                :disabled="rerolling"
                @click="reroll"
              >
                <Sparkles class="w-4 h-4" />
                {{ rerolling
                  ? $t("ideas.rerolling")
                  : current
                    ? $t("ideas.action_reroll")
                    : $t("ideas.action_first_roll") }}
              </button>

              <button
                v-if="current && !rerolling"
                type="button"
                class="px-3 py-2 border-[3px] border-ds-brown/60 text-ds-brown text-sm font-bold hover:bg-ds-brown/5 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="acting"
                @click="saveCurrent"
              >
                {{ $t("ideas.action_save_it") }}
              </button>

              <button
                v-if="current && !rerolling && current.kind === 'project_update' && current.existing_project_id"
                type="button"
                class="px-3 py-2 border-[3px] border-ds-brown/60 text-ds-brown text-sm font-bold hover:bg-ds-brown/5"
                @click="openExistingProject(current)"
              >
                {{ $t("ideas.action_open_project") }}
              </button>

              <button
                v-if="isDev"
                type="button"
                class="ml-auto px-3 py-2 border-[3px] border-ds-danger/60 text-ds-danger text-xs font-bold uppercase tracking-wide hover:bg-ds-danger/10 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="resetting"
                :title="$t('ideas.dev_reset_hint')"
                @click="devReset"
              >
                {{ resetting ? $t("ideas.dev_reset_running") : $t("ideas.dev_reset_button") }}
              </button>
            </div>

            <p
              class="text-[11px] text-ds-brown/55 italic leading-snug -mt-1"
              :title="$t('ideas.disclaimer')"
            >
              {{ $t("ideas.disclaimer_short") }}
            </p>

            <div
              v-if="info"
              class="border-[3px] border-ds-brown/40 bg-ds-brown/5 p-3 text-sm text-ds-brown"
            >
              {{ info }}
            </div>
            <div
              v-if="error"
              class="border-[3px] border-ds-danger bg-ds-danger/10 p-3 text-sm text-ds-danger"
            >
              {{ error }}
            </div>
          </template>

          <template v-else>
            <div class="flex flex-col gap-3">
              <p class="text-sm text-ds-brown">
                {{ $t("ideas.no_hackatime_explainer") }}
              </p>
              <div class="flex flex-wrap gap-2">
                <a
                  :href="HACKATIME_LOGIN_URL"
                  class="inline-flex items-center gap-2 px-4 py-2 border-[3px] border-ds-brown bg-ds-brown text-ds-cream font-bold hover:bg-ds-brown/90"
                >
                  <Sparkles class="w-4 h-4" />
                  {{ $t("ideas.action_link_hackatime") }}
                </a>
                <a
                  :href="WORKSHOPS_INDEX_URL"
                  target="_blank"
                  rel="noreferrer noopener"
                  class="inline-flex items-center gap-2 px-4 py-2 border-[3px] border-ds-brown/40 text-ds-brown hover:border-ds-brown"
                >
                  <ExternalLink class="w-4 h-4" />
                  {{ $t("ideas.action_browse_workshops") }}
                </a>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <h2 class="text-lg font-bold text-ds-brown">
                {{ $t("ideas.beginner_starters_heading") }}
              </h2>
              <ul class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <li
                  v-for="ws in BEGINNER_WORKSHOPS"
                  :key="ws.slug"
                  class="border-[3px] border-ds-brown/30 bg-parchment/60 p-4 flex flex-col gap-3"
                >
                  <h3 class="text-base font-bold text-ds-brown">{{ ws.title }}</h3>
                  <p class="text-sm text-ds-brown/90">{{ ws.description }}</p>
                  <a
                    :href="ws.url"
                    target="_blank"
                    rel="noreferrer noopener"
                    class="inline-flex items-center gap-2 px-3 py-1.5 border-[3px] border-ds-brown bg-ds-brown text-ds-cream text-sm font-bold hover:bg-ds-brown/90 self-start"
                  >
                    <ExternalLink class="w-3.5 h-3.5" />
                    {{ $t("ideas.action_open_workshop") }}
                  </a>
                </li>
              </ul>
            </div>
          </template>

          <div v-if="hasHackatimeToken" class="flex flex-col border-t-[3px] border-ds-brown/20 pt-4">
            <button
              type="button"
              class="flex items-center justify-between gap-2 w-full text-left group"
              :aria-expanded="showSaved"
              @click="showSaved = !showSaved"
            >
              <span class="flex items-center gap-2">
                <ChevronRight
                  class="w-4 h-4 text-ds-brown/70 transition-transform duration-200 ease-out"
                  :class="showSaved ? 'rotate-90' : ''"
                />
                <span class="text-sm font-bold text-ds-brown">
                  {{ $t("ideas.saved_drawer", { count: saved.length }) }}
                </span>
              </span>
              <span class="text-xs text-ds-brown/60">
                {{ showSaved ? $t("ideas.collapse") : $t("ideas.expand") }}
              </span>
            </button>

            <Transition name="drawer">
              <div v-if="showSaved" class="drawer-content">
                <div class="pt-3">
                  <ul v-if="saved.length > 0" class="flex flex-col gap-2">
                    <li
                      v-for="idea in saved"
                      :key="idea.id"
                      class="border-[3px] border-ds-brown/30 bg-parchment/60 p-3 flex flex-col gap-2"
                    >
                      <div class="flex items-start justify-between gap-2 flex-wrap">
                        <h3 class="text-sm font-bold text-ds-brown">{{ idea.title }}</h3>
                        <span class="text-[11px] px-2 py-0.5 border-[2px] border-ds-brown/30 bg-ds-brown/5 whitespace-nowrap">
                          {{ idea.category === 'hardware'
                            ? $t("ideas.category_filter_hardware")
                            : $t("ideas.category_filter_software") }}
                        </span>
                      </div>
                      <p class="text-xs text-ds-brown/80 leading-relaxed">{{ idea.description }}</p>
                      <div class="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          v-if="idea.kind === 'project_update' && idea.existing_project_id"
                          type="button"
                          class="px-3 py-1 border-[3px] border-ds-brown bg-ds-brown text-ds-cream text-xs font-bold hover:bg-ds-brown/90"
                          @click="openExistingProject(idea)"
                        >
                          {{ $t("ideas.action_open_project") }}
                        </button>
                        <button
                          type="button"
                          class="px-3 py-1 border-[3px] border-ds-brown/40 text-ds-brown/70 text-xs hover:border-ds-brown hover:text-ds-brown"
                          @click="unsaveSaved(idea)"
                        >
                          {{ $t("ideas.action_unsave") }}
                        </button>
                      </div>
                    </li>
                  </ul>
                  <div v-else class="text-xs text-ds-brown/60 italic">
                    {{ $t("ideas.empty_saved") }}
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </component>
    </div>
  </div>
</template>

<style scoped>
.idea-fade-enter-active,
.idea-fade-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}
.idea-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.idea-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* steady while typing, blinks during the beats between fields */
.typewriter-cursor {
  display: inline-block;
  margin-left: 1px;
  font-weight: 400;
  animation: typewriter-blink 900ms steps(1, end) infinite;
}
@keyframes typewriter-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* grid-template-rows trick animates to the content's natural height without measuring in JS */
.drawer-content {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 280ms ease, opacity 220ms ease;
  opacity: 1;
}
.drawer-content > * {
  min-height: 0;
  overflow: hidden;
}
.drawer-enter-from,
.drawer-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}
.drawer-enter-to,
.drawer-leave-from {
  grid-template-rows: 1fr;
  opacity: 1;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: grid-template-rows 280ms ease, opacity 220ms ease;
}
</style>
