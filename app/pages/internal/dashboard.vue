<script setup lang="ts">
import { computed } from "vue";
const { t } = useI18n();
const { user } = useAuth();

definePageMeta({
    layout: "internal",
});

const hour = new Date().getHours();
const greeting = computed(() => {
    if (hour >= 5 && hour < 12) return t("good_morning");
    if (hour >= 12 && hour < 18) return t("good_afternoon");
    return t("good_night");
});

const userName = computed(() =>
    (
        (user.value?.name as string) ||
        (user.value?.username as string) ||
        (user.value?.email as string) ||
        "there"
    ).toLowerCase(),
);

const pendingReviews = 5;
</script>

<template>
    <div class="px-8 pb-8 pt-32 max-w-7xl">
        <div class="flex flex-col gap-1">
            <h1 class="text-4xl font-bold text-white tracking-tight">
                {{ greeting }}, {{ userName }}
            </h1>
            <p class="text-zinc-400 text-lg">
                {{ t("internal.section_1_sub_title_dash") }}
                <span class="text-white font-bold">{{ pendingReviews }}</span>
                {{ t("internal.section_2_sub_title_dash") }}
            </p>
        </div>

        <div
            class="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        />
    </div>
</template>
