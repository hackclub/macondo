<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <Callout type="danger" :title="title">
    <slot />
  </Callout>
</template>
