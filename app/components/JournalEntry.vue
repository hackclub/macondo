<script setup lang="ts">
const props = defineProps<{
  entry: {
    id?: number;
    short_brief: string;
    long_brief: string;
    hours: number | null;
    created_at: string;
    archived?: boolean;
    translated_from?: string | null;
    content_language?: string | null;
    // only username + slack_id, never users.name (real-name pii)
    author_id?: string | null;
    author_username?: string | null;
    author_slack_id?: string | null;
    author_image?: string | null;
  };
  hideTitle?: boolean;
  hideAuthor?: boolean;
}>();

const { locale, t } = useI18n();

const LANGUAGE_LABELS: Record<string, { en: string; es: string }> = {
  en: { en: "English", es: "inglés" },
  es: { en: "Spanish", es: "español" },
};

const translatedFromLabel = computed(() => {
  const from = props.entry.translated_from;
  if (!from) return null;
  const currentLocale = (locale.value === "es" ? "es" : "en") as "en" | "es";
  return t("journal.translated_from", { lang: LANGUAGE_LABELS[from]?.[currentLocale] ?? from });
});

const finalHtml = computed(() => renderJournalMarkdown(props.entry.long_brief));

const formattedDate = computed(() => {
  return new Date(props.entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
});
</script>

<template>
  <div class="border-t-[3px] border-ds-brown/20 pt-4" :class="entry.archived ? 'opacity-50' : ''">
    <!-- two rows so a long short_brief can't collide with the meta row -->
    <div v-if="!hideTitle" class="flex flex-col gap-1 mb-3">
      <h3 class="text-lg font-bold text-ds-brown break-words">
        {{ entry.short_brief }}
        <span v-if="entry.archived" class="text-xs font-normal text-ds-brown/40 ml-2">{{ $t("journal.archived_tag") }}</span>
      </h3>
      <div class="flex items-center justify-between gap-3 text-xs text-ds-brown/60">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="whitespace-nowrap">{{ formattedDate }}</span>
          <span
            v-if="!hideAuthor && (entry.author_username || entry.author_slack_id)"
            class="inline-flex items-center gap-1 bg-ds-brown/10 px-2 py-0.5 rounded-full text-ds-brown font-semibold whitespace-nowrap"
            :title="`Written by ${entry.author_username ?? entry.author_slack_id}`"
          >
            <img
              v-if="entry.author_image"
              :src="entry.author_image"
              :alt="entry.author_username ?? ''"
              class="w-4 h-4 border border-ds-brown/30 object-cover"
            >
            <span class="truncate max-w-[10rem]">{{ entry.author_username ?? entry.author_slack_id }}</span>
          </span>
        </div>
        <span v-if="entry.hours" class="shrink-0 bg-ds-brown/10 px-2 py-0.5 rounded-full font-semibold text-ds-brown">
          {{ entry.hours }}h
        </span>
      </div>
    </div>
    <div class="journal-content prose prose-sm max-w-none text-ds-brown/80 break-words overflow-hidden" v-html="finalHtml" />
    <p
      v-if="translatedFromLabel"
      class="mt-2 text-xs italic text-ds-brown/60"
    >
      {{ translatedFromLabel }}
    </p>
  </div>
</template>

<style scoped>
/* pin the prose palette to ds-brown instead of the default gray */
.journal-content {
  --tw-prose-body: #684D3A;
  --tw-prose-headings: #684D3A;
  --tw-prose-lead: #684D3A;
  --tw-prose-bold: #684D3A;
  --tw-prose-counters: #684D3A;
  --tw-prose-bullets: #684D3A;
  --tw-prose-hr: #684D3A;
  --tw-prose-quotes: #684D3A;
  --tw-prose-quote-borders: #684D3A;
  --tw-prose-captions: #684D3A;
  --tw-prose-code: #684D3A;
  --tw-prose-pre-code: #684D3A;
  --tw-prose-th-borders: #684D3A;
  --tw-prose-td-borders: #684D3A;
}

.journal-content :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}

.journal-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}

.journal-content :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0.5em 0 0.25em;
}

.journal-content :deep(ul),
.journal-content :deep(ol) {
  padding-left: 1.5rem;
  margin: 0.5em 0;
}

.journal-content :deep(ul) {
  list-style-type: disc;
}

.journal-content :deep(ol) {
  list-style-type: decimal;
}

.journal-content :deep(li) {
  margin: 0.25em 0;
}

/* prose dims list markers; match them to the body copy */
.journal-content :deep(li::marker) {
  color: #684D3A;
}

.journal-content :deep(p) {
  margin: 0.5em 0;
}

.journal-content :deep(hr) {
  border-top: 1px solid #684D3A;
  margin: 1em 0;
}

.journal-content :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 0.5em 0;
}

.journal-content :deep(video) {
  max-width: 100%;
  margin: 0.5em 0;
  display: block;
}

.journal-content :deep(pre) {
  background: rgba(0, 0, 0, 0.05);
  padding: 0.75rem;
  border-radius: 6px;
  overflow-x: auto;
}

.journal-content :deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}

/* tailwind typography adds literal backticks around inline code via ::before/::after */
.journal-content :deep(code)::before,
.journal-content :deep(code)::after {
  content: none;
}

.journal-content :deep(pre code) {
  background: none;
  padding: 0;
}

.journal-content {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.journal-content :deep(a) {
  color: #0366d6;
  text-decoration: underline;
}

.journal-content :deep(blockquote) {
  border-left: 3px solid #684D3A;
  padding-left: 1rem;
  color: #684D3A;
  font-style: italic;
}
</style>
