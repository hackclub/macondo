<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <Callout type="note" :title="title">
    <slot />
  </Callout>
</template>
