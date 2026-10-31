<script setup lang="ts">
import { tutorialSteps } from '~/data/tutorialStepData';
import TutorialStep from '~/components/tutorial/TutorialStep.vue';
import { resetGlossaryTracking } from '~/utils/glossary';

// Learn-only: progress lives in localStorage and nothing is saved to a Macondo project.

const { user, isLoggedIn, loading, fetchSession } = useAuth();
const route = useRoute();

if (import.meta.client) {
  watch(
    [isLoggedIn, loading],
    ([loggedIn, isLoadingNow]) => {
      if (!isLoadingNow && !loggedIn) navigateTo('/');
    },
    { immediate: true },
  );
}

const STORAGE_KEY = 'guide:html:progress';

type Progress = {
  stepIndex: number;
  phase: 'goal' | 'tinker' | 'explain' | 'apply';
  userCode: { html: string; css: string; readme: string };
  tinkerCode?: { html: string; css: string; readme: string };
  tinkerChallengesCompleted?: number[];
};

const initial: Progress = {
  stepIndex: 0,
  phase: 'goal',
  userCode: { html: '', css: '', readme: '' },
};

const progress = ref<Progress>({ ...initial });

// Seeded synchronously from the query so deep links into deploy never flash a tutorial
// step; githubBootstrapping also hides the connect -> name-repo flicker.
const enteringDeploy =
  route.query.deploy === '1' || route.query.github === 'connected';
const mode = ref<'tutorial' | 'github'>(enteringDeploy ? 'github' : 'tutorial');
const githubBootstrapping = ref(enteringDeploy);

const githubSubStep = ref<'connect' | 'name-repo' | 'deploying' | 'deployed'>('connect');
const githubUsername = ref('');
const repoName = ref('my-website');
const repoFullName = ref('');
const pagesUrl = ref('');
const repoUrl = ref('');
const deployError = ref('');
const creating = ref(false);
const deploying = ref(false);

const siteReady = ref(false);
const pollTimedOut = ref(false);

// Caught before the README step so images get fixed before writing it; the deploy-time
// check is only a safety net.
const imageValidationError = ref('');

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[-_.]+/, '')
    .replace(/[-_.]+$/, '');
}

async function fetchGithubUsername() {
  try {
    githubUsername.value = (await $fetch<{ username: string }>('/api/github/me')).username;
  } catch {
    // Non-fatal
  }
}

// Only http(s) srcs count: relative paths or data: URIs won't resolve on GitHub Pages.
function extractImageSrcs(html: string): string[] {
  return [...html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1]?.trim() ?? '')
    .filter((s) => /^https?:\/\//i.test(s));
}

// Image() avoids CORS preflights; retried because CDN thumbnails fail intermittently.
function probeImageLoads(url: string): Promise<boolean> {
  const attempt = () => new Promise<boolean>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 8000); // give up on a slow image after 8s
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
  return (async () => {
    for (let i = 0; i < 3; i++) { // three load attempts
      if (await attempt()) return true;
      if (i < 2) await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })();
}

async function validateImagesBeforeDeploy(): Promise<string | null> {
  const srcs = extractImageSrcs(progress.value.userCode.html);
  if (srcs.length === 0) {
    return 'Add at least one <img> tag with a real image URL before deploying.';
  }
  const broken = (await Promise.all(
    srcs.map(async (url) => ({ url, ok: await probeImageLoads(url) })),
  )).filter((r) => !r.ok).map((r) => r.url);
  if (broken.length > 0) {
    return `These images don't load: ${broken.join(', ')}. Update the src to a working URL before deploying.`;
  }
  return null;
}

async function createRepo() {
  creating.value = true;
  deployError.value = '';
  try {
    const imageError = await validateImagesBeforeDeploy();
    if (imageError) {
      deployError.value = imageError;
      githubSubStep.value = 'name-repo';
      return;
    }
    const res = await $fetch<{ repo: string; html_url: string }>('/api/github/create-repo', {
      method: 'POST',
      body: { name: repoName.value },
    });
    repoFullName.value = res.repo;
    repoUrl.value = res.html_url;
    githubSubStep.value = 'deploying';
    await deployToGitHub();
  } catch (e: unknown) {
    deployError.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to create repository';
    githubSubStep.value = 'name-repo';
  } finally {
    creating.value = false;
  }
}

async function deployToGitHub() {
  deploying.value = true;
  deployError.value = '';
  try {
    const readme = progress.value.userCode.readme || '';

    const res = await $fetch<{ pages_url: string; repo_url: string }>('/api/github/push', {
      method: 'POST',
      body: {
        repo: repoFullName.value,
        html: progress.value.userCode.html,
        css: progress.value.userCode.css,
        readme: readme,
      },
    });
    pagesUrl.value = res.pages_url;
    repoUrl.value = res.repo_url;
    githubSubStep.value = 'deployed';
    pollForSite(res.pages_url);
  } catch (e: unknown) {
    deployError.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to deploy';
    githubSubStep.value = 'name-repo';
  } finally {
    deploying.value = false;
  }
}

async function pollForSite(url: string) {
  siteReady.value = false;
  pollTimedOut.value = false;
  for (let i = 0; i < 24; i++) { // ~2 minutes at 5s intervals
    try {
      const res = await $fetch<{ ready: boolean }>('/api/github/pages-status', {
        params: { repo: repoFullName.value },
      });
      if (res.ready) {
        siteReady.value = true;
        window.open(url, '_blank');
        return;
      }
    } catch {
      // API error, keep polling
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  pollTimedOut.value = true;
}

onMounted(async () => {
  // Glossary highlights are once per session; reset so each visit highlights the core terms.
  resetGlossaryTracking();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { mode: savedMode, githubSubStep: savedSub, ...progressData } = JSON.parse(raw);
      progress.value = { ...initial, ...progressData };
      if (savedMode === 'github') {
        mode.value = 'github';
        // 'deploying' can't safely resume, so retry from 'name-repo'.
        githubSubStep.value = savedSub === 'deploying' || !savedSub ? 'name-repo' : savedSub;
      }
    }
  } catch {
    // Ignore corrupt persisted state; start fresh.
  }

  // Refresh the session so `has_github` reflects a newly stored token; otherwise a learner
  // who already linked GitHub would wrongly land on 'connect'.
  if (route.query.github === 'connected' || route.query.deploy === '1') {
    if (route.query.github === 'connected' || !user.value) {
      await fetchSession();
    }
    mode.value = 'github';
    if (user.value?.has_github) {
      await fetchGithubUsername();
      githubSubStep.value = 'name-repo';
    } else {
      githubSubStep.value = 'connect';
    }
    githubBootstrapping.value = false;
  }
});

function persist() {
  try {
    const data = {
      ...progress.value,
      mode: mode.value,
      githubSubStep: githubSubStep.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Out of storage is non-fatal here; the guide still works in memory.
  }
}

watch([mode, githubSubStep], () => persist());

function onSave(data: Record<string, unknown>) {
  progress.value = { ...progress.value, ...(data as Partial<Progress>) };
  persist();
}

async function onComplete(userCode: { html: string; css: string; readme: string }) {
  progress.value.userCode = userCode;
  const next = progress.value.stepIndex + 1;
  if (next < tutorialSteps.length && tutorialSteps[next]?.id === 'readme') {
    const imageError = await validateImagesBeforeDeploy();
    if (imageError) {
      imageValidationError.value = imageError;
      persist();
      return;
    }
  }
  if (next >= tutorialSteps.length) {
    persist();
    mode.value = 'github';
    if (user.value?.has_github) {
      await fetchGithubUsername();
      githubSubStep.value = 'name-repo';
    } else {
      githubSubStep.value = 'connect';
    }
    return;
  }
  progress.value.stepIndex = next;
  progress.value.phase = 'goal';
  progress.value.tinkerCode = undefined;
  progress.value.tinkerChallengesCompleted = undefined;
  persist();
}

function clearImageValidationError() {
  imageValidationError.value = '';
}

function onBack() {
  if (progress.value.stepIndex === 0) {
    void navigateTo('/dashboard?from=fade');
    return;
  }
  progress.value.stepIndex -= 1;
  progress.value.phase = 'apply';
  progress.value.tinkerCode = undefined;
  progress.value.tinkerChallengesCompleted = undefined;
  persist();
}

function onResetStep() {
  progress.value.phase = 'goal';
  progress.value.tinkerCode = undefined;
  progress.value.tinkerChallengesCompleted = undefined;
  persist();
}

function resetLocalProgress() {
  progress.value = { ...initial };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function onBackToFarm() {
  void navigateTo('/dashboard?from=fade');
}

async function onDeployedContinue() {
  resetLocalProgress();
  await navigateTo('/dashboard?from=landing');
}

async function onContinueEditing() {
  resetLocalProgress();
  await navigateTo('/docs/environment');
}

function onBackToEditor() {
  // persist() so a refresh doesn't bounce them back to the deploy screen.
  mode.value = 'tutorial';
  progress.value.stepIndex = tutorialSteps.length - 1;
  progress.value.phase = 'apply';
  deployError.value = '';
  persist();
}
</script>

<template>
  <div class="h-screen bg-parchment text-ds-brown overflow-hidden">
    <!-- The wrapper needs an explicit height (not min-height) for TutorialStep's h-full split.
         Never put a comment at the template root: Nuxt goes multi-root and overflows the stack. -->
    <TutorialStep
      v-if="mode === 'tutorial'"
      :step-index="progress.stepIndex"
      :initial-phase="progress.phase"
      :user-code="progress.userCode"
      :tinker-code="progress.tinkerCode"
      :tinker-challenges-completed="progress.tinkerChallengesCompleted"
      :external-error="imageValidationError"
      @complete="onComplete"
      @save="onSave"
      @back="onBack"
      @back-to-farm="onBackToFarm"
      @reset-step="onResetStep"
      @clear-external-error="clearImageValidationError"
    />

    <div v-if="mode === 'github'" class="max-w-2xl mx-auto px-6 py-16 h-full overflow-y-auto flex flex-col min-h-full">
      <div v-if="githubBootstrapping" class="flex flex-col items-center gap-4 text-center flex-1">
        <h2 class="text-3xl font-bold text-ds-brown">
          {{ $t("onboarding.github.deploy_heading") }}
        </h2>
        <div class="w-8 h-8 border-[3px] border-ds-brown/20 border-t-ds-brown rounded-full animate-spin" />
      </div>
      <Transition v-else name="fade" mode="out-in">
        <div :key="githubSubStep" class="flex flex-col items-center gap-4 text-center flex-1">
            <h2 class="text-3xl font-bold text-ds-brown">
              {{ $t("onboarding.github.deploy_heading") }}
            </h2>

            <template v-if="githubSubStep === 'connect'">
              <p class="text-ds-brown/70 max-w-md">
                {{ $t("onboarding.github.connect_body") }}
              </p>
              <a
                href="/api/auth/github/login?return_to=/guides/html?deploy=1"
                class="ds-btn-primary inline-block"
              >
                {{ $t("onboarding.github_connect") }}
              </a>
              <NuxtLink
                to="/dashboard?from=fade"
                class="text-sm text-ds-brown underline hover:opacity-70 transition-opacity"
              >
                {{ $t("onboarding.github.back_to_farm") }}
              </NuxtLink>
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
              <button
                type="button"
                class="text-sm text-ds-brown underline hover:opacity-70 transition-opacity"
                :disabled="creating"
                @click="onBackToEditor"
              >
                {{ $t("onboarding.github.back_to_editor") }}
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
                @click="onDeployedContinue"
              >
                {{ $t("common.continue") }}
              </button>

              <div class="w-full max-w-sm pt-4 mt-2 border-t-[3px] border-ds-brown/20 flex flex-col items-center gap-3 text-center">
                <p class="text-sm text-ds-brown/70 max-w-xs">
                  {{ $t("onboarding.github.keep_editing_body") }}
                </p>
                <button
                  class="ds-btn-primary-inverted"
                  @click="onContinueEditing"
                >
                  {{ $t("onboarding.github.keep_editing_cta") }}
                </button>
              </div>
            </template>
        </div>
      </Transition>
    </div>
  </div>
</template>
