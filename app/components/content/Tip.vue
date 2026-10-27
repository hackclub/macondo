<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <Callout type="tip" :title="title">
    <slot />
  </Callout>
</template>
