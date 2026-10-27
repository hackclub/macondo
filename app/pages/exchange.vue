<script setup lang="ts">
// retired after the fruit-to-gold migration; the currency guide now holds the fruits-earned breakdown.
definePageMeta({
    layout: false,
});

await navigateTo("/currency", { replace: true, redirectCode: 301 });
</script>

<template>
    <div />
</template>
