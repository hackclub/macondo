<script setup lang="ts">
import { NotebookPen } from "lucide-vue-next";
</script>

<template>
  <div
    class="not-prose flex gap-4 mb-6 p-4 sm:p-5 border-l-[6px] items-start"
    style="background: rgb(255 183 116 / 0.18); border-left-color: #FFB774;"
  >
    <NotebookPen :size="32" color="#8a5320" class="shrink-0 mt-0.5" />
    <div class="flex-1 min-w-0">
      <div class="font-bold text-lg sm:text-xl uppercase tracking-wide leading-tight" style="color: #8a5320;">
        {{ $t("docs.journal_required.title") }}
      </div>
      <p class="text-sm sm:text-base text-ds-brown/90 mt-2 leading-relaxed">
        {{ $t("docs.journal_required.body") }}
      </p>
      <NuxtLink
        to="/docs/journals"
        class="inline-block mt-3 text-sm font-bold underline decoration-2 underline-offset-2 hover:opacity-70"
        style="color: #8a5320;"
      >
        {{ $t("docs.journal_required.cta") }} &rarr;
      </NuxtLink>
    </div>
  </div>
</template>
