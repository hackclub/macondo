<script setup lang="ts">
// Escape everything, then linkify http(s) URLs, so the output is v-html safe.
// No DOMPurify on purpose: ~150KB the bundle guard keeps off public pages.
const props = defineProps<{ text: string | null | undefined }>();

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const html = computed(() => {
  // excluding "<" means a match can't break out of href; trailing punctuation stays outside
  return escapeHtml(props.text ?? "")
    .replace(/https?:\/\/[^\s<]+/g, (match) => {
      const trailing = match.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
      const url = trailing ? match.slice(0, -trailing.length) : match;
      return `<a href="${url}" target="_blank" rel="noopener nofollow ugc" class="underline">${url}</a>${trailing}`;
    })
    .replace(/\n/g, "<br>");
});
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <span v-html="html" />
  <!-- eslint-enable vue/no-v-html -->
</template>
