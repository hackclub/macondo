<script setup lang="ts">
import { useLazyMarkdown } from "~/utils/lazyMarkdown";

// shared so every surface rendering untrusted-ish markdown sanitizes identically
const props = defineProps<{ source: string }>();

const renderedHtml = ref("");
onMounted(async () => {
  const { renderSafeMarkdown } = await useLazyMarkdown();
  renderedHtml.value = renderSafeMarkdown(props.source ?? "", {
    linkify: true,
  });
});
watch(
  () => props.source,
  async (next) => {
    const { renderSafeMarkdown } = await useLazyMarkdown();
    renderedHtml.value = renderSafeMarkdown(next ?? "", { linkify: true });
  },
);

// after sanitization, so opened links can't reach back into the opener
const finalHtml = computed(() =>
  renderedHtml.value.replace(
    /<a /g,
    '<a target="_blank" rel="noopener noreferrer" ',
  ),
);
</script>

<template>
  <div class="md-content prose prose-sm max-w-none break-words overflow-hidden" v-html="finalHtml" />
</template>

<style scoped>
.md-content {
  --tw-prose-body: #684d3a;
  --tw-prose-headings: #684d3a;
  --tw-prose-lead: #684d3a;
  --tw-prose-bold: #684d3a;
  --tw-prose-counters: #684d3a;
  --tw-prose-bullets: #684d3a;
  --tw-prose-hr: #684d3a;
  --tw-prose-quotes: #684d3a;
  --tw-prose-quote-borders: #684d3a;
  --tw-prose-captions: #684d3a;
  --tw-prose-code: #684d3a;
  --tw-prose-pre-code: #684d3a;
  --tw-prose-th-borders: #684d3a;
  --tw-prose-td-borders: #684d3a;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.md-content :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}

.md-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}

.md-content :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0.5em 0 0.25em;
}

.md-content :deep(ul),
.md-content :deep(ol) {
  padding-left: 1.5rem;
  margin: 0.5em 0;
}

.md-content :deep(ul) {
  list-style-type: disc;
}

.md-content :deep(ol) {
  list-style-type: decimal;
}

.md-content :deep(li) {
  margin: 0.25em 0;
}

.md-content :deep(li::marker) {
  color: #684d3a;
}

.md-content :deep(p) {
  margin: 0.5em 0;
}

.md-content :deep(hr) {
  border-top: 1px solid #684d3a;
  margin: 1em 0;
}

.md-content :deep(img) {
  max-width: 100%;
  margin: 0.5em 0;
}

.md-content :deep(pre) {
  background: rgba(0, 0, 0, 0.05);
  padding: 0.75rem;
  overflow-x: auto;
}

.md-content :deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 5px;
  font-size: 0.9em;
}

.md-content :deep(code)::before,
.md-content :deep(code)::after {
  content: none;
}

.md-content :deep(pre code) {
  background: none;
  padding: 0;
}

.md-content :deep(a) {
  color: #0366d6;
  text-decoration: underline;
}

.md-content :deep(blockquote) {
  border-left: 3px solid #684d3a;
  padding-left: 1rem;
  color: #684d3a;
  font-style: italic;
}
</style>
