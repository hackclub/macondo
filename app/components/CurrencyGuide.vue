<script setup lang="ts">
import { fruits, levelConfig, type ProjectLevel, type ProjectCategory } from "~/data/fruitLevels";
import { formatGold } from "~/utils/formatGold";

defineProps<{
    embedded?: boolean;
}>();

// lifetime_earned sums all increases, not net of unlock spends.
const { data: starfruitStats } = await useFetch<{
    balance: number;
    lifetime_earned: number;
}>("/api/users/starfruit", {
    default: () => ({ balance: 0, lifetime_earned: 0 }),
    server: false,
});
const lifetimeStarfruit = computed(() => starfruitStats.value?.lifetime_earned ?? 0);

const LEVEL_META: Record<ProjectLevel, { labelKey: string; descriptionKey: string }> = {
    1: { labelKey: "currency_page.level_1_label", descriptionKey: "currency_page.level_1_description" },
    2: { labelKey: "currency_page.level_2_label", descriptionKey: "currency_page.level_2_description" },
    3: { labelKey: "currency_page.level_3_label", descriptionKey: "currency_page.level_3_description" },
    4: { labelKey: "currency_page.level_4_label", descriptionKey: "currency_page.level_4_description" },
};

const levels: ProjectLevel[] = [1, 2, 3, 4];
const categories: ProjectCategory[] = ["software", "hardware"];

function fruitFor(level: ProjectLevel, category: ProjectCategory) {
    return fruits.find((f) => f.level === level && f.category === category);
}

const streakDays = ref(10);
const streakMultiplier = computed(() => 1 + streakDays.value * 0.01); // 1% bonus per streak day
const streakExampleBaseHours = 5;
const streakExampleAward = computed(() =>
    Math.floor(streakExampleBaseHours * levelConfig[2].goldPerHour * streakMultiplier.value),
);

// Must mirror the ship-approval payout: floor(hours * rate * (1 + streak * 0.01)).
const calcCategory = ref<ProjectCategory>("software");
const calcLevel = ref<ProjectLevel>(1);
const calcHours = ref(10);
const calcStreak = ref(7);

const calcRate = computed(() => levelConfig[calcLevel.value].goldPerHour);
const calcMultiplier = computed(() => 1 + Math.max(0, calcStreak.value || 0) * 0.01); // 1% bonus per streak day
const calcBaseGold = computed(() => Math.floor(Math.max(0, calcHours.value || 0) * calcRate.value));
const calcTotalGold = computed(() =>
    Math.floor(Math.max(0, calcHours.value || 0) * calcRate.value * calcMultiplier.value),
);
const calcBonusGold = computed(() => calcTotalGold.value - calcBaseGold.value);
const calcFruit = computed(() => fruitFor(calcLevel.value, calcCategory.value));

// Mirrors server streakToStage.
const calcStageIndex = computed(() => {
    const d = Math.max(0, calcStreak.value || 0);
    if (d >= 10) return 4;
    if (d >= 6) return 3;
    if (d >= 3) return 2;
    return 1;
});
const STAGE_KEYS = ["calc_stage_seedling", "calc_stage_sprout", "calc_stage_leafy", "calc_stage_fruiting"];
const calcStageKey = computed(() => STAGE_KEYS[calcStageIndex.value - 1]!);
const calcStageImage = computed(() => calcFruit.value?.stages?.[calcStageIndex.value - 1] ?? null);

function setCalcLevel(value: string) {
    const n = Number(value);
    if (n >= 1 && n <= 4) calcLevel.value = n as ProjectLevel;
}

const { data: lifetimeFruitsData } = await useFetch<{
    totals: Record<string, number>;
    total: number;
}>("/api/users/lifetime-fruits", {
    default: () => ({ totals: {}, total: 0 }),
    server: false,
});

const lifetimeTotals = computed(() => lifetimeFruitsData.value?.totals ?? {});
const lifetimeTotal = computed(() => lifetimeFruitsData.value?.total ?? 0);
function lifetimeCountFor(name: string) {
    return Number(lifetimeTotals.value[name] ?? 0);
}
</script>

<template>
    <div class="flex flex-col gap-6">
        <div>
            <h1 v-if="!embedded" class="text-2xl font-bold text-ds-brown mb-3">
                {{ $t("currency_page.heading") }}
            </h1>
            <p class="text-sm text-ds-brown/80 leading-relaxed mb-4">
                {{ $t("currency_page.intro") }}
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="flex items-start gap-3 p-3 border-[2px] border-ds-brown/15 bg-white/40">
                    <img src="/images/icons/money.webp" class="w-10 h-10 object-contain shrink-0" alt="">
                    <div>
                        <h3 class="text-sm font-bold text-ds-brown">{{ $t("currency_page.gold_title") }}</h3>
                        <p class="text-xs text-ds-brown/70 leading-snug">{{ $t("currency_page.gold_blurb") }}</p>
                    </div>
                </div>
                <div class="flex items-start gap-3 p-3 border-[2px] border-ds-brown/15 bg-white/40">
                    <img src="/images/fruits/mango/icon.webp" class="w-10 h-10 object-contain shrink-0" alt="">
                    <div>
                        <h3 class="text-sm font-bold text-ds-brown">{{ $t("currency_page.fruits_title") }}</h3>
                        <p class="text-xs text-ds-brown/70 leading-snug">{{ $t("currency_page.fruits_blurb") }}</p>
                    </div>
                </div>
                <div class="flex items-start gap-3 p-3 border-[2px] border-ds-brown/15 bg-white/40">
                    <img src="/images/fruits/starfruit.webp" class="w-10 h-10 object-contain shrink-0" alt="">
                    <div>
                        <h3 class="text-sm font-bold text-ds-brown">{{ $t("currency_page.starfruit_title") }}</h3>
                        <p class="text-xs text-ds-brown/70 leading-snug">{{ $t("currency_page.starfruit_blurb") }}</p>
                    </div>
                </div>
                <div class="flex items-start gap-3 p-3 border-[2px] border-ds-brown/15 bg-white/40">
                    <div class="w-10 h-10 flex items-center justify-center shrink-0 text-2xl">🔥</div>
                    <div>
                        <h3 class="text-sm font-bold text-ds-brown">{{ $t("currency_page.streaks_title") }}</h3>
                        <p class="text-xs text-ds-brown/70 leading-snug">{{ $t("currency_page.streaks_blurb") }}</p>
                    </div>
                </div>
            </div>
        </div>

        <div>
            <h2 class="text-lg font-bold text-ds-brown mb-2">
                {{ $t("currency_page.lifetime_fruits_title") }}
            </h2>
            <p class="text-xs text-ds-brown/70 mb-5">
                {{ $t("currency_page.lifetime_fruits_blurb") }}
            </p>
            <div class="flex flex-col gap-4">
                <div
                    v-for="category in categories"
                    :key="category"
                    class="flex flex-col gap-2"
                >
                    <div class="flex items-baseline justify-between gap-2">
                        <h3 class="text-sm font-bold text-ds-brown uppercase tracking-wider">
                            {{ $t(`currency_page.category_${category}`) }}
                        </h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div
                            v-for="level in levels"
                            :key="level"
                            class="flex flex-col gap-2 p-3 border-[2px] border-ds-brown/15 bg-white/40"
                        >
                            <div class="flex items-baseline justify-between gap-2">
                                <span class="text-xs font-bold uppercase tracking-wider text-ds-brown/50">
                                    L{{ level }}
                                </span>
                            </div>
                            <div v-if="fruitFor(level, category)" class="flex items-center gap-2">
                                <img
                                    :src="fruitFor(level, category)!.icon"
                                    :alt="fruitFor(level, category)!.name"
                                    class="w-10 h-10 object-contain shrink-0"
                                >
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-bold text-ds-brown truncate">
                                        {{ fruitFor(level, category)!.name }}
                                    </p>
                                    <p class="text-lg font-bold text-ds-brown">
                                        {{ formatGold(lifetimeCountFor(fruitFor(level, category)!.name)) }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="mt-4 flex items-center justify-between p-3 border-[3px] border-ds-brown/20 bg-ds-brown/5">
                <span class="flex items-center gap-2 text-sm font-bold text-ds-brown">
                    <img src="/images/fruits/starfruit.webp" class="w-5 h-5 object-contain" alt="">
                    {{ $t("currency_page.lifetime_starfruit_total") }}
                </span>
                <span class="text-xl font-bold text-ds-brown">{{ formatGold(lifetimeStarfruit) }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between p-3 border-[3px] border-ds-brown/20 bg-ds-brown/5">
                <span class="text-sm font-bold text-ds-brown">{{ $t("currency_page.lifetime_fruits_total") }}</span>
                <span class="text-xl font-bold text-ds-brown">{{ formatGold(lifetimeTotal) }}</span>
            </div>
            <p class="text-[11px] text-ds-brown/60 mt-3 leading-snug">
                {{ $t("currency_page.lifetime_fruits_footnote") }}
            </p>
        </div>

        <div>
            <h2 class="text-lg font-bold text-ds-brown mb-2">
                {{ $t("currency_page.tier_chart_heading") }}
            </h2>
            <p class="text-xs text-ds-brown/70 mb-5">
                {{ $t("currency_page.tier_chart_description") }}
            </p>
            <div class="flex flex-col gap-4">
                <div
                    v-for="category in categories"
                    :key="category"
                    class="flex flex-col gap-2"
                >
                    <div class="flex items-baseline justify-between gap-2">
                        <h3 class="text-sm font-bold text-ds-brown uppercase tracking-wider">
                            {{ $t(`currency_page.category_${category}`) }}
                        </h3>
                        <span class="text-[10px] text-ds-brown/60 uppercase tracking-wider">
                            {{ $t(`currency_page.category_${category}_blurb`) }}
                        </span>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div
                            v-for="level in levels"
                            :key="level"
                            class="flex flex-col gap-2 p-3 border-[3px] border-ds-brown/20 bg-ds-brown/5"
                        >
                            <div class="flex items-baseline justify-between gap-2">
                                <span class="text-xs font-bold uppercase tracking-wider text-ds-brown/50">
                                    L{{ level }}
                                </span>
                                <span class="text-[10px] uppercase tracking-wider text-ds-brown/50">
                                    {{ $t(LEVEL_META[level].labelKey) }}
                                </span>
                            </div>
                            <div v-if="fruitFor(level, category)" class="flex items-center gap-2">
                                <img
                                    :src="fruitFor(level, category)!.icon"
                                    :alt="fruitFor(level, category)!.name"
                                    class="w-10 h-10 object-contain shrink-0"
                                >
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-bold text-ds-brown truncate">
                                        {{ fruitFor(level, category)!.name }}
                                    </p>
                                </div>
                            </div>
                            <div class="text-[11px] text-ds-brown/60 font-bold uppercase tracking-wider pt-1 border-t border-ds-brown/10">
                                {{ $t("currency_page.gold_per_hour", { n: levelConfig[level].goldPerHour }) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="streaks">
            <h2 class="text-lg font-bold text-ds-brown mb-2">
                {{ $t("currency_page.streak_heading") }}
            </h2>
            <p class="text-xs text-ds-brown/70 mb-5 leading-relaxed">
                {{ $t("currency_page.streak_description") }}
            </p>
            <div class="flex flex-col gap-4 p-4 border-[3px] border-ds-brown/20 bg-ds-brown/5">
                <label class="flex flex-col gap-2">
                    <span class="text-xs font-bold uppercase tracking-wider text-ds-brown/70">
                        {{ $t("currency_page.streak_slider_label", { count: streakDays }) }}
                    </span>
                    <input
                        v-model.number="streakDays"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        class="w-full accent-ds-brown"
                        :aria-label="$t('currency_page.streak_slider_aria')"
                    >
                    <span class="text-[11px] text-ds-brown/60 leading-snug">
                        {{ $t("currency_page.streak_per_project_note") }}
                    </span>
                </label>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.streak_formula_label") }}
                        </span>
                        <span class="text-sm font-bold text-ds-brown block mt-1">
                            1 + ({{ streakDays }} × 0.01)
                        </span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.streak_multiplier_label") }}
                        </span>
                        <span class="text-2xl font-bold text-ds-brown block">
                            {{ streakMultiplier.toFixed(2) }}x
                        </span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.streak_example_label", { base: streakExampleBaseHours }) }}
                        </span>
                        <span class="text-2xl font-bold text-ds-brown block">
                            {{ formatGold(streakExampleAward) }} {{ $t("currency_page.gold_unit") }}
                        </span>
                    </div>
                </div>
            </div>
            <p class="text-[11px] text-ds-brown/60 mt-3 leading-snug">
                {{ $t("currency_page.streak_footnote") }}
            </p>
        </div>

        <div id="calculator">
            <h2 class="text-lg font-bold text-ds-brown mb-2">
                {{ $t("currency_page.calc_heading") }}
            </h2>
            <p class="text-xs text-ds-brown/70 mb-5 leading-relaxed">
                {{ $t("currency_page.calc_description") }}
            </p>
            <div class="flex flex-col gap-4 p-4 border-[3px] border-ds-brown/20 bg-ds-brown/5">
                <div class="flex gap-2">
                    <button
                        v-for="cat in categories"
                        :key="cat"
                        type="button"
                        class="flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wide border-[2px] border-ds-brown transition-all active:scale-95"
                        :class="calcCategory === cat ? 'bg-ds-brown text-ds-cream' : 'bg-ds-brown/10 text-ds-brown hover:bg-ds-brown/20'"
                        @click="calcCategory = cat"
                    >
                        {{ $t(`currency_page.category_${cat}`) }}
                    </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold">
                            {{ $t("currency_page.calc_level_label") }}
                        </span>
                        <select
                            :value="calcLevel"
                            class="ds-select"
                            @change="setCalcLevel(($event.target as HTMLSelectElement).value)"
                        >
                            <option v-for="lvl in levels" :key="lvl" :value="lvl">
                                L{{ lvl }} · {{ $t(LEVEL_META[lvl].labelKey) }}
                            </option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold">
                            {{ $t("currency_page.calc_hours_label") }}
                        </span>
                        <input
                            v-model.number="calcHours"
                            type="number"
                            min="0"
                            step="0.5"
                            :placeholder="$t('currency_page.calc_hours_placeholder')"
                            class="ds-input"
                        >
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold">
                            {{ $t("currency_page.calc_streak_label") }}
                        </span>
                        <input
                            v-model.number="calcStreak"
                            type="number"
                            min="0"
                            step="1"
                            :placeholder="$t('currency_page.calc_streak_placeholder')"
                            class="ds-input"
                        >
                    </label>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div class="p-3 border-[3px] border-ds-brown/20 bg-white/40 col-span-2 sm:col-span-1">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_total") }}
                        </span>
                        <span class="text-2xl font-bold text-ds-brown block mt-1">
                            {{ formatGold(calcTotalGold) }} {{ $t("currency_page.gold_unit") }}
                        </span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_base") }}
                        </span>
                        <span class="text-sm font-bold text-ds-brown block mt-1">{{ formatGold(calcBaseGold) }}</span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_bonus") }}
                        </span>
                        <span class="text-sm font-bold text-ds-success block mt-1">+{{ formatGold(calcBonusGold) }}</span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_rate") }}
                        </span>
                        <span class="text-sm font-bold text-ds-brown block mt-1">
                            {{ $t("currency_page.calc_result_rate_unit", { n: calcRate }) }}
                        </span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_multiplier") }}
                        </span>
                        <span class="text-sm font-bold text-ds-brown block mt-1">{{ calcMultiplier.toFixed(2) }}x</span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_fruit") }}
                        </span>
                        <span class="flex items-center gap-1.5 mt-1">
                            <img
                                v-if="calcFruit"
                                :src="calcFruit.icon"
                                :alt="calcFruit.name"
                                class="w-5 h-5 object-contain shrink-0"
                            >
                            <span class="text-sm font-bold text-ds-brown truncate">{{ calcFruit?.name }}</span>
                        </span>
                    </div>
                    <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40">
                        <span class="text-[10px] text-ds-brown/50 uppercase tracking-wide font-bold block">
                            {{ $t("currency_page.calc_result_stage") }}
                        </span>
                        <span class="flex items-center gap-1.5 mt-1">
                            <img
                                v-if="calcStageImage"
                                :src="calcStageImage"
                                :alt="$t(`currency_page.${calcStageKey}`)"
                                class="w-5 h-5 object-contain shrink-0"
                            >
                            <span class="text-sm font-bold text-ds-brown truncate">
                                {{ $t(`currency_page.${calcStageKey}`) }}
                            </span>
                        </span>
                    </div>
                </div>

                <div class="p-3 border-[2px] border-ds-brown/15 bg-white/40 text-xs text-ds-brown/80">
                    <template v-if="calcTotalGold > 0">
                        {{ $t("currency_page.calc_formula", {
                            base: formatGold(calcBaseGold),
                            bonus: formatGold(calcBonusGold),
                            days: Math.max(0, calcStreak || 0),
                            percent: Math.max(0, calcStreak || 0),
                            total: formatGold(calcTotalGold),
                        }) }}
                    </template>
                    <template v-else>
                        {{ $t("currency_page.calc_formula_empty") }}
                    </template>
                </div>
            </div>
            <p class="text-[11px] text-ds-brown/60 mt-3 leading-snug">
                {{ $t("currency_page.calc_credit_prefix") }}
                <a
                    href="https://github.com/olii-dev/macondo-currency-calculator"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline hover:opacity-70"
                >olii-dev</a>.
            </p>
        </div>

        <div class="flex flex-wrap gap-3 text-xs">
            <NuxtLink
                to="/docs/currency"
                class="underline text-ds-brown hover:opacity-70"
            >
                {{ $t("currency_page.footer_docs_currency") }}
            </NuxtLink>
            <NuxtLink
                to="/docs/how-levels-work"
                class="underline text-ds-brown hover:opacity-70"
            >
                {{ $t("currency_page.footer_docs_levels") }}
            </NuxtLink>
        </div>
    </div>
</template>
