<script setup lang="ts">
// frozen: streak held by a freeze; dim: at-risk or not yet worked
const props = defineProps<{ frozen?: boolean; dim?: boolean }>();

const src = computed(() =>
  props.frozen ? "/images/streak/frozen.webp" : "/images/streak/fire.webp",
);
</script>

<template>
  <img
    :src="src"
    alt=""
    aria-hidden="true"
    draggable="false"
    class="object-contain inline-block select-none"
    :class="{ 'grayscale opacity-50': dim }"
  >
</template>
