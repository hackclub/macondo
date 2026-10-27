<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <Callout type="warning" :title="title">
    <slot />
  </Callout>
</template>
