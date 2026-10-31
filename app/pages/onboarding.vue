<script setup lang="ts">
import { tutorialSteps } from '~/data/tutorialStepData';
import { storyPart1Scenes, storyPart2aScenes, askProjectScenes, skipTutorialScenes } from '~/data/storylineData';
import { resetGlossaryTracking } from '~/utils/glossary';

const { user, fetchSession } = useAuth();
const route = useRoute();
const isDev = import.meta.dev;

const currentStep = ref("story-part1");
const onboardingData = ref<Record<string, unknown>>({});
const saving = ref(false);

let legacyProjectGuideStep = false;
const { data: serverState } = await useFetch("/api/onboarding", { default: () => null });
if (serverState.value) {
  let step = serverState.value.step || "story-part1";
  if (step === "welcome" || step === "story-intro") step = "story-part1";
  if (step === "story-farming" || step === "story-part3") step = "complete";
  if (step === "experience") step = "ask-project";
  if (step === "story-part2b") step = "ask-project";
  if (step === "create-project-guide") legacyProjectGuideStep = true;
  currentStep.value = step;
  onboardingData.value = serverState.value.data || {};
}

const steps = ["story-part1", "story-part2a", "ask-project", "tutorial", "github", "skip-tutorial", "complete"] as const;
const stepIndex = computed(() => steps.indexOf(currentStep.value as typeof steps[number]));
const progress = computed(() => (stepIndex.value / (steps.length - 1)) * 100);

async function saveStep(step: string, data?: Record<string, unknown>) {
  saving.value = true;
  if (data) Object.assign(onboardingData.value, data);
  currentStep.value = step;
  try {
    await $fetch("/api/onboarding", {
      method: "POST",
      body: { step, data: onboardingData.value },
    });
  } finally {
    saving.value = false;
  }
}

async function completeOnboarding() {
  await saveStep("complete");
  if (user.value) user.value.onboarding_step = "complete";
  navigateTo("/dashboard");
}

onMounted(() => {
  if (legacyProjectGuideStep) void completeOnboarding();
});

function downloadProjectFiles() {
  for (const file of [
    { name: "index.html", content: userHtml.value || "" },
    { name: "style.css", content: userCss.value || "" },
    { name: "README.md", content: userReadme.value || "" },
  ]) {
    if (!file.content.trim()) continue;
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function onStoryPart1Complete() {
  saveStep("story-part2a");
}

function onStoryPart2aComplete() {
  saveStep("ask-project");
}

async function onAskProjectChoice(value: string) {
  if (value === "yes") {
    // guide progress lives in localStorage on /guides/html, not in onboarding_data.
    await saveStep("complete", { wantsWebsite: true });
    if (user.value) user.value.onboarding_step = "complete";
    navigateTo("/guides/html");
  } else {
    saveStep("skip-tutorial");
  }
}

async function onSkipTutorialComplete() {
  await completeOnboarding();
}

const currentSubStep = ref((onboardingData.value.tutorialSubStep as number) || 0);
const userHtml = ref((onboardingData.value.userHtml as string) || "");
const userCss = ref((onboardingData.value.userCss as string) || "");
const userReadme = ref((onboardingData.value.userReadme as string) || "");
const tutorialPhase = ref<"goal" | "tinker" | "explain" | "apply">(
  (onboardingData.value.tutorialPhase as "goal" | "tinker" | "explain" | "apply") || "goal"
);
const tinkerCode = ref(
  (onboardingData.value.tinkerCode as { html: string; css: string; readme: string }) || { html: "", css: "", readme: "" }
);
const tinkerChallengesCompleted = ref<number[]>(
  (onboardingData.value.tinkerChallengesCompleted as number[]) || []
);
const maxSubStepReached = ref<number>(
  (onboardingData.value.maxSubStepReached as number) ?? (onboardingData.value.tutorialSubStep as number) ?? 0
);

// part of the TutorialStep :key so a dev reset remounts it and re-inits its local refs.
const tutorialResetNonce = ref(0);

watch(
  () => currentStep.value,
  (step) => {
    if (step === "tutorial") resetGlossaryTracking();
  },
  { immediate: true },
);

const advancing = ref(false);
const showRewardModal = ref(false);
const rewardDeployed = ref(false);

async function onSubStepComplete(code: { html: string; css: string; readme: string }) {
  if (advancing.value) return;
  advancing.value = true;
  userHtml.value = code.html;
  userCss.value = code.css;
  userReadme.value = code.readme;

  tinkerCode.value = { html: "", css: "", readme: "" };
  tinkerChallengesCompleted.value = [];
  tutorialPhase.value = "goal";

  if (currentSubStep.value < tutorialSteps.length - 1) {
    currentSubStep.value++;
    if (currentSubStep.value > maxSubStepReached.value) {
      maxSubStepReached.value = currentSubStep.value;
    }
    saveStep("tutorial", {
      tutorialSubStep: currentSubStep.value,
      tutorialPhase: "goal",
      userHtml: userHtml.value,
      userCss: userCss.value,
      userReadme: userReadme.value,
      tinkerCode: tinkerCode.value,
      tinkerChallengesCompleted: tinkerChallengesCompleted.value,
      maxSubStepReached: maxSubStepReached.value,
    });
  } else {
    await saveStep("tutorial", {
      tutorialSubStep: currentSubStep.value,
      userHtml: userHtml.value,
      userCss: userCss.value,
      userReadme: userReadme.value,
      htmlGuideCompleted: true,
    });
    showRewardModal.value = true;
  }
  advancing.value = false;
}

function onRewardDownload() {
  downloadProjectFiles();
}

async function onRewardBackToFarm() {
  showRewardModal.value = false;
  await completeOnboarding();
}

async function onRewardDeploy() {
  showRewardModal.value = false;
  await saveStep("github");
}

async function onRewardContinueCss() {
  showRewardModal.value = false;
  await saveStep("complete", { cssTutorialUnlocked: true });
  if (user.value) user.value.onboarding_step = "complete";
  navigateTo("/dashboard");
}

// fire-and-forget: awaiting would freeze navigation for several hundred ms.
function onTutorialBackToFarm() {
  saveStep("tutorial", {
    tutorialSubStep: currentSubStep.value,
    tutorialPhase: tutorialPhase.value,
    userHtml: userHtml.value,
    userCss: userCss.value,
    userReadme: userReadme.value,
    tinkerCode: tinkerCode.value,
    tinkerChallengesCompleted: tinkerChallengesCompleted.value,
  }).catch((e) => console.error("Back-to-farm: failed to save tutorial step", e));
  navigateTo("/dashboard");
}

function onTutorialSave(data: Record<string, unknown>) {
  if (data.tutorialPhase) tutorialPhase.value = data.tutorialPhase as typeof tutorialPhase.value;
  if (data.tinkerCode) tinkerCode.value = data.tinkerCode as typeof tinkerCode.value;
  if (data.tinkerChallengesCompleted) tinkerChallengesCompleted.value = data.tinkerChallengesCompleted as number[];
  if (data.userCode) {
    const code = data.userCode as { html: string; css: string; readme: string };
    userHtml.value = code.html;
    userCss.value = code.css;
    userReadme.value = code.readme;
  }
  saveStep("tutorial", {
    tutorialSubStep: currentSubStep.value,
    tutorialPhase: tutorialPhase.value,
    userHtml: userHtml.value,
    userCss: userCss.value,
    userReadme: userReadme.value,
    tinkerCode: tinkerCode.value,
    tinkerChallengesCompleted: tinkerChallengesCompleted.value,
  });
}

function onTutorialBack() {
  if (currentSubStep.value > 0) {
    currentSubStep.value--;
    tutorialPhase.value = "apply";
    tinkerCode.value = { html: "", css: "", readme: "" };
    tinkerChallengesCompleted.value = [];
    saveStep("tutorial", {
      tutorialSubStep: currentSubStep.value,
      tutorialPhase: "apply",
      userHtml: userHtml.value,
      userCss: userCss.value,
      userReadme: userReadme.value,
    });
  }
}

// clamping maxSubStepReached makes isRevisiting false so the challenges run again;
// cumulative userHtml/userCss/userReadme are left alone.
function onTutorialResetStep() {
  tinkerCode.value = { html: "", css: "", readme: "" };
  tinkerChallengesCompleted.value = [];
  tutorialPhase.value = "goal";
  if (maxSubStepReached.value > currentSubStep.value) {
    maxSubStepReached.value = currentSubStep.value;
  }
  tutorialResetNonce.value++;
  saveStep("tutorial", {
    tutorialSubStep: currentSubStep.value,
    tutorialPhase: "goal",
    tinkerCode: tinkerCode.value,
    tinkerChallengesCompleted: tinkerChallengesCompleted.value,
    maxSubStepReached: maxSubStepReached.value,
    userHtml: userHtml.value,
    userCss: userCss.value,
    userReadme: userReadme.value,
  });
}

const githubSubStep = ref<"connect" | "name-repo" | "deploying" | "deployed">("connect");
const githubUsername = ref("");
const repoName = ref("my-website");

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[-_.]+/, "")
    .replace(/[-_.]+$/, "");
}
const repoFullName = ref("");
const pagesUrl = ref("");
const repoUrl = ref("");
const deployError = ref("");
const creating = ref(false);
const deploying = ref(false);

async function fetchGithubUsername() {
  try {
    githubUsername.value = (await $fetch<{ username: string }>("/api/github/me")).username;
  } catch {
    // Non-fatal
  }
}

if (route.query.github === "connected") {
  fetchSession();
  fetchGithubUsername();
  githubSubStep.value = "name-repo";
  currentStep.value = "github";
}
watch(() => user.value?.has_github, (hasGh) => {
  if (hasGh && githubSubStep.value === "connect") {
    fetchGithubUsername();
    githubSubStep.value = "name-repo";
  }
}, { immediate: true });

async function createRepo() {
  creating.value = true;
  deployError.value = "";
  try {
    const res = await $fetch<{ repo: string; html_url: string }>("/api/github/create-repo", {
      method: "POST",
      body: { name: repoName.value },
    });
    repoFullName.value = res.repo;
    repoUrl.value = res.html_url;
    githubSubStep.value = "deploying";
    await deployToGitHub();
  } catch (e: unknown) {
    deployError.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage || "Failed to create repository";
  } finally {
    creating.value = false;
  }
}

async function deployToGitHub() {
  deploying.value = true;
  deployError.value = "";
  try {
    const readme = userReadme.value || '';

    const res = await $fetch<{ pages_url: string; repo_url: string }>("/api/github/push", {
      method: "POST",
      body: {
        repo: repoFullName.value,
        html: userHtml.value,
        css: userCss.value,
        readme: readme,
      },
    });
    pagesUrl.value = res.pages_url;
    repoUrl.value = res.repo_url;
    githubSubStep.value = "deployed";
    pollForSite(res.pages_url);
  } catch (e: unknown) {
    deployError.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage || "Failed to deploy";
    githubSubStep.value = "name-repo";
  } finally {
    deploying.value = false;
  }
}

const siteReady = ref(false);
const pollTimedOut = ref(false);

async function pollForSite(url: string) {
  siteReady.value = false;
  pollTimedOut.value = false;
  for (let i = 0; i < 24; i++) { // max attempts, ~2 minutes at 5s intervals
    try {
      if ((await $fetch<{ ready: boolean }>("/api/github/pages-status", {
        params: { repo: repoFullName.value },
      })).ready) {
        siteReady.value = true;
        window.open(url, "_blank");
        return;
      }
    } catch {
      // API error, keep polling
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  pollTimedOut.value = true;
}

async function devResetOnboarding() {
  await $fetch("/api/onboarding", {
    method: "POST",
    body: { step: "story-part1", data: {} },
  });
  window.location.reload();
}

function devPrevStep() {
  const idx = steps.indexOf(currentStep.value as typeof steps[number]);
  if (idx > 0) {
    saveStep(steps[idx - 1]);
  }
}

function devNextStep() {
  const idx = steps.indexOf(currentStep.value as typeof steps[number]);
  if (idx < steps.length - 1) {
    saveStep(steps[idx + 1]);
  }
}
</script>

<template>
  <div class="min-h-screen bg-parchment text-ds-brown">
    <div v-if="!['tutorial', 'story-part1', 'story-part2a', 'ask-project', 'skip-tutorial'].includes(currentStep)" class="fixed top-0 left-0 right-0 z-50 h-1 bg-ds-brown/10">
      <div
        class="h-full bg-ds-brown transition-all duration-500"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <StorylinePlayer
      v-if="currentStep === 'story-part1'"
      :scenes="storyPart1Scenes"
      @complete="onStoryPart1Complete"
    />

    <StorylinePlayer
      v-if="currentStep === 'story-part2a'"
      :scenes="storyPart2aScenes"
      @complete="onStoryPart2aComplete"
    />

    <StorylinePlayer
      v-if="currentStep === 'ask-project'"
      :scenes="askProjectScenes"
      @choice="onAskProjectChoice"
    />

    <StorylinePlayer
      v-if="currentStep === 'skip-tutorial'"
      :scenes="skipTutorialScenes"
      @complete="onSkipTutorialComplete"
    />

    <div v-if="currentStep === 'github'" class="max-w-2xl mx-auto px-6 py-16">
      <Transition name="fade" mode="out-in">
        <div v-if="currentStep === 'github'" key="github" class="flex flex-col items-center gap-4 text-center">
          <h2 class="text-3xl font-bold text-ds-brown">
            {{ $t("onboarding.github.deploy_heading") }}
          </h2>

          <template v-if="githubSubStep === 'connect'">
            <p class="text-ds-brown/70 max-w-md">
              {{ $t("onboarding.github.connect_body") }}
            </p>
            <a
              href="/api/auth/github/login"
              class="ds-btn-primary inline-block"
            >
              {{ $t("onboarding.github_connect") }}
            </a>
            <p class="text-ds-brown/40 text-xs max-w-sm">
              {{ $t("onboarding.github.download_and_skip_body") }}
            </p>
            <div class="flex flex-col items-center gap-2 mt-2">
              <button
                class="ds-btn-ghost text-sm"
                @click="downloadProjectFiles(); completeOnboarding()"
              >
                {{ $t("onboarding.github.download_and_skip") }}
              </button>
            </div>
          </template>

          <template v-else-if="githubSubStep === 'name-repo'">
            <p class="text-ds-brown/70 max-w-md">
              {{ $t("onboarding.github.name_repo_body") }}
            </p>
            <div class="w-full max-w-sm">
              <label class="text-xs font-bold uppercase tracking-wide text-left block mb-1 text-ds-brown">{{ $t("onboarding.github.repo_name_label") }}</label>
              <input
                :value="repoName"
                type="text"
                class="w-full ds-input font-mono text-sm"
                placeholder="my-website"
                @input="repoName = sanitizeRepoName(($event.target as HTMLInputElement).value)"
              >
              <p class="text-xs text-ds-brown/50 mt-1 text-left">
                {{ $t("onboarding.github.site_url_preview", { username: githubUsername || $t("common.username"), repo: repoName || "my-website" }) }}
              </p>
            </div>
            <p v-if="deployError" class="text-ds-danger text-sm">{{ deployError }}</p>
            <button
              :disabled="!repoName.trim() || creating"
              class="ds-btn-primary"
              @click="createRepo"
            >
              {{ creating ? $t("onboarding.github.creating") : $t("onboarding.github.create_and_deploy") }}
            </button>
          </template>

          <template v-else-if="githubSubStep === 'deploying'">
            <p class="text-ds-brown/70">{{ $t("onboarding.github.deploying") }}</p>
            <div class="w-8 h-8 border-3 border-ds-brown/20 border-t-ds-brown rounded-full animate-spin" />
          </template>

          <template v-else-if="githubSubStep === 'deployed'">
            <template v-if="!siteReady && !pollTimedOut">
              <p class="text-ds-brown/70 max-w-md">
                {{ $t("onboarding.github.waiting_live") }}
              </p>
              <div class="w-10 h-10 border-[3px] border-ds-warning/30 border-t-ds-warning rounded-full animate-spin" />
              <p class="text-ds-brown/70 max-w-md">{{ $t("onboarding.github.auto_open") }}</p>
              <p class="text-ds-brown/70 max-w-md">{{ $t("onboarding.github.popup_fallback") }}</p>
            </template>

            <template v-else-if="siteReady">
              <p class="text-lg font-bold text-ds-success">
                {{ $t("onboarding.github.site_live") }}
              </p>
              <p class="text-ds-brown/70 text-xs">{{ $t("onboarding.github.popup_fallback") }}</p>
            </template>

            <template v-else>
              <p class="text-ds-brown/70 max-w-md">
                {{ $t("onboarding.github.taking_longer") }}
              </p>
            </template>

            <div class="w-full max-w-sm space-y-3 text-left">
              <div class="p-4 border-[3px] border-ds-brown">
                <p class="text-xs font-bold uppercase tracking-wide mb-1 text-ds-brown">{{ $t("onboarding.github.your_site") }}</p>
                <a :href="pagesUrl" target="_blank" class="text-sm font-mono underline break-all text-ds-brown/70">{{ pagesUrl }}</a>
              </div>
              <div class="p-4 border-[3px] border-ds-brown">
                <p class="text-xs font-bold uppercase tracking-wide mb-1 text-ds-brown">{{ $t("onboarding.github.repository") }}</p>
                <a :href="repoUrl" target="_blank" class="text-sm font-mono underline break-all text-ds-brown/70">{{ repoUrl }}</a>
              </div>
            </div>
            <button
              class="ds-btn-primary"
              @click="completeOnboarding"
            >
              {{ $t("common.continue") }}
            </button>
          </template>
        </div>
      </Transition>
    </div>

    <div v-if="currentStep === 'tutorial'" class="fixed inset-0 bg-parchment text-ds-brown">
      <TutorialStep
        :key="`tutorial-${tutorialResetNonce}`"
        :step-index="currentSubStep"
        :initial-phase="tutorialPhase"
        :user-code="{ html: userHtml, css: userCss, readme: userReadme }"
        :tinker-code="tinkerCode"
        :tinker-challenges-completed="tinkerChallengesCompleted"
        :is-revisiting="currentSubStep < maxSubStepReached"
        :disable-escape="showRewardModal"
        @complete="onSubStepComplete"
        @save="onTutorialSave"
        @back="onTutorialBack"
        @back-to-farm="onTutorialBackToFarm"
        @reset-step="onTutorialResetStep"
      />
      <TutorialRewardModal
        v-if="showRewardModal"
        :deployed="rewardDeployed"
        :has-github="!!user?.has_github"
        @deploy="onRewardDeploy"
        @download="onRewardDownload"
        @continue-css="onRewardContinueCss"
        @back-to-farm="onRewardBackToFarm"
      />
    </div>
    <div v-if="isDev" class="fixed bottom-4 right-4 z-[9999] flex gap-2 items-center">
      <span class="text-[10px] text-ds-brown/40 font-mono">{{ currentStep }}</span>
      <button
        class="px-2 py-1.5 bg-gray-600 text-white text-xs font-bold rounded shadow-lg hover:bg-gray-700 transition-colors opacity-50 hover:opacity-100"
        @click="devPrevStep"
      >
        &larr;
      </button>
      <button
        class="px-2 py-1.5 bg-gray-600 text-white text-xs font-bold rounded shadow-lg hover:bg-gray-700 transition-colors opacity-50 hover:opacity-100"
        @click="devNextStep"
      >
        &rarr;
      </button>
      <button
        class="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded shadow-lg hover:bg-red-700 transition-colors opacity-50 hover:opacity-100"
        @click="devResetOnboarding"
      >
        Reset
      </button>
      <button
        class="px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded shadow-lg hover:bg-amber-700 transition-colors opacity-50 hover:opacity-100"
        @click="completeOnboarding"
      >
        Skip
      </button>
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
