<script setup lang="ts">
const props = withDefaults(defineProps<{ variant?: "light" | "dark" }>(), {
  variant: "dark",
});

const SPONSORS = [
  { key: "mit", name: "MIT", href: "https://www.mit.edu" },
  { key: "github", name: "GitHub", href: "https://github.com" },
  { key: "amd", name: "AMD", href: "https://www.amd.com" },
  { key: "gwc", name: "Girls Who Code", href: "https://girlswhocode.com" },
  {
    key: "cac",
    name: "Congressional App Challenge",
    href: "https://www.congressionalappchallenge.us",
  },
];

const failed = ref(new Set<string>());
function onError(key: string) {
  failed.value = new Set(failed.value).add(key);
}
function logoSrc(key: string) {
  return props.variant === "light"
    ? `/images/certificate/sponsors/${key}-cream.webp`
    : `/images/certificate/sponsors/${key}.webp`;
}
const textClass = computed(() =>
  props.variant === "light" ? "text-parchment/90" : "text-ds-brown/80",
);
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
    <a
      v-for="s in SPONSORS"
      :key="s.key"
      :href="s.href"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center transition-opacity hover:opacity-80"
    >
      <img
        v-if="!failed.has(s.key)"
        :src="logoSrc(s.key)"
        :alt="s.name"
        class="h-12 sm:h-16 w-auto object-contain"
        loading="lazy"
        @error="onError(s.key)"
      >
      <span v-else class="text-sm font-bold" :class="textClass">{{ s.name }}</span>
    </a>
  </div>
</template>
