<script setup lang="ts">
import { tutorialSteps, type TutorialSubStepData } from '~/data/tutorialStepData';
import CopySnippet from '~/components/tutorial/CopySnippet.vue';
import { ArrowLeft, ExternalLink, BookCheck } from 'lucide-vue-next';

// Read-only reference for learners who finished /guides/html, so they can revisit it
// without re-entering the editor (which would re-create a draft farm project).

const { user, loading } = useAuth();
const { locale, t, te } = useI18n();

const isCompleted = computed(() => {
  const completed = (user.value as Record<string, unknown> | null)?.completed_guides;
  if (!Array.isArray(completed)) return false;
  return (completed as unknown[]).includes('html');
});

// Wait for auth to settle: `user.value` is null during the initial /api/auth/me
// round-trip, so everyone would get kicked on first paint.
if (import.meta.client) {
  watch(
    [loading, isCompleted],
    ([isLoadingNow, completed]) => {
      if (!isLoadingNow && !completed) {
        navigateTo('/guides/html', { replace: true });
      }
    },
    { immediate: true },
  );
}

// Same i18n resolution as TutorialStep.vue, so learners see the copy they had in the guide.
function localizeStepField(
  step: TutorialSubStepData,
  field: 'title' | 'goal_description' | 'explain_content' | 'apply_instructions',
  fallback: string,
): string {
  const key = `tutorial_content.${step.id}.${field}`;
  return te(key) ? t(key) : fallback;
}

interface ReferenceStep {
  id: string;
  title: string;
  goalDescription: string;
  explainContent: string;
  previewHtml: string;
  previewCss: string;
  previewReadme: string;
  snippets: TutorialSubStepData['explain']['snippets'];
  learnMoreLinks: TutorialSubStepData['explain']['learnMoreLinks'];
}

const steps = computed<ReferenceStep[]>(() =>
  tutorialSteps.map((step) => ({
    id: step.id,
    title: localizeStepField(step, 'title', step.title),
    goalDescription: localizeStepField(step, 'goal_description', step.goal.description),
    explainContent: localizeStepField(step, 'explain_content', step.explain.content),
    previewHtml: step.goal.previewCode.html ?? '',
    previewCss: step.goal.previewCode.css ?? '',
    previewReadme: step.goal.previewCode.readme ?? '',
    snippets: step.explain.snippets,
    learnMoreLinks: step.explain.learnMoreLinks,
  })),
);

const docTitle = computed(() => `${t('personal_website_doc.title')} - ${t('personal_website_doc.subtitle')}`);
const docDescription = computed(() => t('personal_website_doc.intro'));

useSeoMeta({
  title: () => docTitle.value,
  description: () => docDescription.value,
  ogTitle: () => docTitle.value,
  ogDescription: () => docDescription.value,
  ogType: 'article',
  twitterCard: 'summary_large_image',
});

if (import.meta.server) {
  defineOgImage('Macondo', {
    title: docTitle.value,
    description: docDescription.value,
    kind: 'doc',
  });
}

useSchemaOrg([
  defineArticle({
    headline: () => docTitle.value,
    description: () => docDescription.value,
    inLanguage: () => locale.value,
  }),
]);

useHead({
  link: [
    { rel: 'alternate', hreflang: 'en', href: '/docs/personal-website' },
    { rel: 'alternate', hreflang: 'es', href: '/docs/personal-website' },
    { rel: 'alternate', hreflang: 'x-default', href: '/docs/personal-website' },
  ],
});

const docAccent = inject<Ref<string>>('docAccent', ref('#684D3A'));
</script>

<template>
  <div>
    <details class="xl:hidden mb-6 border-l-4 bg-ds-brown/5 p-3 doc-toc-mobile" :style="{ borderColor: docAccent }">
      <summary class="cursor-pointer font-bold text-sm text-ds-brown uppercase tracking-wide select-none">
        {{ $t("docs.on_this_page") }}
      </summary>
      <div class="mt-3">
        <DocToc :accent="docAccent" />
      </div>
    </details>

    <div v-if="!loading && isCompleted" class="prose prose-sm prose-brown max-w-none">
      <div
        class="not-prose flex gap-3 items-start p-4 mb-6 border-[3px] border-ds-brown/30 bg-ds-brown/5"
      >
        <BookCheck :size="20" class="shrink-0 mt-0.5 text-ds-brown/70" />
        <p class="text-sm leading-relaxed text-ds-brown m-0">
          {{ $t("personal_website_doc.completed_banner") }}
        </p>
      </div>

      <h1>{{ $t("personal_website_doc.title") }}</h1>
      <p class="text-ds-brown/70">{{ $t("personal_website_doc.intro") }}</p>

      <section
        v-for="(step, index) in steps"
        :key="step.id"
        class="mt-10"
      >
        <p
          class="not-prose text-xs font-bold uppercase tracking-widest text-ds-brown/40 mb-1"
        >
          {{ $t("personal_website_doc.step_label", { n: index + 1 }) }}
        </p>
        <h2 :id="`step-${step.id}`" class="!mt-1">{{ step.title }}</h2>

        <p
          class="!my-3
                 [&_code]:bg-ds-brown/8 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                 [&_a]:underline
                 [&_strong]:font-semibold"
          v-html="step.goalDescription"
        />

        <h3>{{ $t("personal_website_doc.what_youll_learn") }}</h3>
        <!-- Curated guide HTML (as in PhaseExplain.vue); the child selectors mirror its typography. -->
        <div
          class="not-prose text-sm leading-relaxed text-ds-brown space-y-3 my-3
                 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-2
                 [&_h4]:text-base [&_h4]:font-bold [&_h4]:mt-4 [&_h4]:mb-1
                 [&_p]:leading-relaxed
                 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
                 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1
                 [&_li]:pl-0.5
                 [&_a]:underline
                 [&_code]:bg-ds-brown/8 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                 [&_strong]:font-semibold"
          v-html="step.explainContent"
        />

        <template v-if="step.previewHtml || step.previewCss || step.previewReadme">
          <h3>{{ $t("personal_website_doc.final_example") }}</h3>
          <div class="not-prose space-y-3">
            <CopySnippet
              v-if="step.previewHtml"
              :code="step.previewHtml"
              language="html"
              :label="$t('personal_website_doc.final_example_html')"
            />
            <CopySnippet
              v-if="step.previewCss"
              :code="step.previewCss"
              language="css"
              :label="$t('personal_website_doc.final_example_css')"
            />
            <CopySnippet
              v-if="step.previewReadme"
              :code="step.previewReadme"
              language="markdown"
              :label="$t('personal_website_doc.final_example_readme')"
            />
          </div>
        </template>

        <template v-if="step.snippets.length > 0">
          <h3>{{ $t("personal_website_doc.snippets") }}</h3>
          <div class="not-prose space-y-3">
            <CopySnippet
              v-for="snippet in step.snippets"
              :key="snippet.label"
              :code="snippet.code"
              :language="snippet.language"
              :label="snippet.label"
            />
          </div>
        </template>

        <template v-if="step.learnMoreLinks.length > 0">
          <h3>{{ $t("personal_website_doc.learn_more") }}</h3>
          <ul>
            <li v-for="link in step.learnMoreLinks" :key="link.url">
              <a :href="link.url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1">
                {{ link.label }}
                <ExternalLink :size="12" class="inline-block" />
              </a>
            </li>
          </ul>
        </template>
      </section>

      <div class="not-prose mt-12 pt-6 border-t-[3px] border-ds-brown/15">
        <NuxtLink
          to="/docs/guided-projects"
          class="inline-flex items-center gap-2 text-sm font-bold text-ds-brown hover:opacity-70 no-underline"
        >
          <ArrowLeft :size="16" :stroke-width="2.5" />
          {{ $t("personal_website_doc.back_to_guides") }}
        </NuxtLink>
      </div>
    </div>

    <!-- Non-completers see this briefly before being redirected to /guides/html. -->
    <div v-else class="text-center py-12 text-ds-brown/60 text-sm">
      <span v-if="loading">{{ $t("common.loading") }}</span>
    </div>
  </div>
</template>
