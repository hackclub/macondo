<script setup lang="ts">
import * as icons from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    to: string;
    title: string;
    description?: string;
    icon?: string;
    accent?: string;
    size?: "md" | "lg";
  }>(),
  { size: "md", accent: "#684D3A" },
);

const iconComponent = computed(() => {
  if (!props.icon) return null;
  const pascal = props.icon
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return (icons as Record<string, unknown>)[pascal] ?? null;
});
</script>

<template>
  <NuxtLink
    :to="to"
    class="doc-card not-prose group flex flex-col no-underline p-5 bg-parchment border-[3px] border-ds-brown/20 transition-colors"
    :class="[size === 'lg' ? 'min-h-[12rem]' : 'min-h-[8rem]']"
    :style="{ borderTopColor: accent, borderTopWidth: '6px' }"
  >
    <div class="flex items-start gap-3">
      <component
        v-if="iconComponent"
        :is="iconComponent"
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
.doc-card:hover {
  background: rgb(246 229 199 / 0.8);
  border-color: rgb(104 77 58 / 0.5);
}
</style>
