<script setup lang="ts">
definePageMeta({ layout: "internal" });

const route = useRoute();

const itemId = computed(() => {
    const parsedId = Number(
        Array.isArray(route.params.id)
            ? route.params.id[0]
            : route.params.id,
    );

    return Number.isInteger(parsedId) && parsedId > 0
        ? parsedId
        : null;
});
</script>

<template>
    <InternalShopItemEditor mode="edit" :item-id="itemId" />
</template>
