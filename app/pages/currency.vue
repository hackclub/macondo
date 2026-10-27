<script setup lang="ts">
definePageMeta({
    layout: false,
});

const route = useRoute();
const isWindowed = computed(() => route.query.windowed === "1");
</script>

<template>
    <div :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'">
        <div class="max-w-4xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-6">
            <NuxtLink
                v-if="!isWindowed"
                to="/dashboard"
                class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t("currency_page.back_to_farm") }}
            </NuxtLink>

            <CurrencyGuide />

            <NuxtLink
                to="/shop"
                class="underline text-ds-brown hover:opacity-70 text-xs self-start"
            >
                {{ $t("currency_page.footer_shop") }}
            </NuxtLink>
        </div>
    </div>
</template>
