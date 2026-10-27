<script setup lang="ts">
withDefaults(
  defineProps<{
    cols?: 1 | 2 | 3;
  }>(),
  { cols: 3 },
);
</script>

<template>
  <div
    class="doc-card-grid not-prose grid gap-4 my-6"
    :class="{
      'grid-cols-1': cols === 1,
      'grid-cols-1 md:grid-cols-2': cols === 2,
      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3': cols === 3,
    }"
  >
    <slot />
  </div>
</template>
