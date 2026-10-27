<script setup lang="ts">
import * as icons from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: string;
    accent?: string;
    size?: "md" | "lg";
    completedLabel?: string;
  }>(),
  {
    size: "md",
    accent: "#684D3A",
    icon: "file-code",
    completedLabel: "Already completed",
  },
);

const { user } = useAuth();

const isCompleted = computed(() => {
  const completed = (user.value as Record<string, unknown> | null)?.completed_guides;
  if (!Array.isArray(completed)) return false;
  return completed.includes("html");
});

const iconComponent = computed(() => {
  if (!props.icon) return null;
  const pascal = props.icon
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return (icons as Record<string, unknown>)[pascal] ?? null;
});

const Check = icons.CircleCheck;
</script>

<template>
  <!-- completed stays clickable so users can revisit the lesson -->
  <NuxtLink
    v-if="isCompleted"
    to="/docs/personal-website"
    class="doc-card doc-card-done not-prose group flex flex-col no-underline p-5 bg-ds-brown/5 border-[3px] border-ds-brown/15 transition-colors"
    :class="[size === 'lg' ? 'min-h-[12rem]' : 'min-h-[8rem]']"
    :style="{ borderTopColor: accent, borderTopWidth: '6px' }"
  >
    <div class="flex items-start gap-3">
      <component
        :is="iconComponent"
        v-if="iconComponent"
        :size="size === 'lg' ? 28 : 22"
        :color="accent"
        class="shrink-0"
      />
      <div class="flex-1 min-w-0">
        <div
          class="font-bold text-ds-brown leading-tight"
          :class="[size === 'lg' ? 'text-xl' : 'text-base']"
        >
          {{ title }}
        </div>
      </div>
      <span class="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-ds-brown/60 shrink-0">
        <Check :size="14" />
        {{ completedLabel }}
      </span>
    </div>
    <p v-if="description" class="mt-2 text-sm text-ds-brown/70 leading-relaxed m-0">
      {{ description }}
    </p>
  </NuxtLink>

  <NuxtLink
    v-else
    to="/guides/html"
    class="doc-card not-prose group flex flex-col no-underline p-5 bg-parchment border-[3px] border-ds-brown/20 transition-colors"
    :class="[size === 'lg' ? 'min-h-[12rem]' : 'min-h-[8rem]']"
    :style="{ borderTopColor: accent, borderTopWidth: '6px' }"
  >
    <div class="flex items-start gap-3">
      <component
        :is="iconComponent"
        v-if="iconComponent"
        :size="size === 'lg' ? 28 : 22"
        :color="accent"
        class="shrink-0"
      />
      <div class="flex-1 min-w-0">
        <div
          class="font-bold text-ds-brown leading-tight"
          :class="[size === 'lg' ? 'text-xl' : 'text-base']"
        >
          {{ title }}
        </div>
      </div>
      <span
        class="text-ds-brown/40 group-hover:text-ds-brown transition-all group-hover:translate-x-1"
        :class="[size === 'lg' ? 'text-2xl' : 'text-lg']"
      >
        &rarr;
      </span>
    </div>
    <p v-if="description" class="mt-2 text-sm text-ds-brown/70 leading-relaxed m-0">
      {{ description }}
    </p>
  </NuxtLink>
</template>

<style scoped>
.doc-card:not(.doc-card-done):hover {
  background: rgb(246 229 199 / 0.8);
  border-color: rgb(104 77 58 / 0.5);
}
.doc-card.doc-card-done:hover {
  background: rgb(104 77 58 / 0.08);
  border-color: rgb(104 77 58 / 0.3);
}
</style>
