<script setup lang="ts">
definePageMeta({
    layout: false,
});

const me = await $fetch<{
    permissions: { isSupportOnly?: boolean };
}>("/api/internal/me").catch(() => null);

await navigateTo(
    me?.permissions?.isSupportOnly ? "/internal/support" : "/internal/dashboard",
    { replace: true },
);
</script>

<template>
    <div />
</template>
