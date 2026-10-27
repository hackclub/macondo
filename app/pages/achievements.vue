<script setup lang="ts">
import type { Component } from "vue";
import { Award, ChevronLeft, Coins, Crown, ExternalLink, Flame, Leaf, Lock, Snowflake, Sprout, TreePine, Trophy } from "lucide-vue-next";

definePageMeta({ layout: false });

type AchievementState = {
  key: string;
  category: "streak" | "gold" | "projects" | "secret";
  metric: string;
  threshold: number;
  icon: string;
  secret: boolean;
  unlocked: boolean;
  unlocked_at: string | null;
  value: number;
};
type AchievementsResponse = {
  stats: { streak: number; gold: number; projects: number; ships: number; upvotes: number };
  achievements: AchievementState[];
};

// Non-awaited useFetch so it can mount in the dashboard modal without a Suspense boundary.
const props = defineProps<{ embeddedWindowed?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { isLoggedIn, signIn } = useAuth();

function goBack(): void {
  if (props.embeddedWindowed) emit("close");
  else void navigateTo("/dashboard");
}

const { data } = useFetch<AchievementsResponse>("/api/achievements", {
  default: () => ({
    stats: { streak: 0, gold: 0, projects: 0, ships: 0, upvotes: 0 },
    achievements: [],
  }),
  server: false,
});

const achievements = computed(() => data.value?.achievements ?? []);
const unlockedCount = computed(() => achievements.value.filter((a) => a.unlocked).length);
const totalCount = computed(() => achievements.value.length);
const overallPct = computed(() =>
  totalCount.value > 0 ? Math.round((unlockedCount.value / totalCount.value) * 100) : 0,
);

const CATEGORIES = ["streak", "gold", "projects", "secret"] as const;
const grouped = computed(() =>
  CATEGORIES.map((category) => ({
    category,
    items: achievements.value.filter((a) => a.category === category),
  })).filter((g) => g.items.length > 0),
);

const ICONS: Record<string, Component> = { Flame, Coins, Sprout, Leaf, TreePine, Snowflake, Award, Crown, Trophy };
function iconFor(a: AchievementState): Component {
  if (a.secret && !a.unlocked) return Lock;
  return ICONS[a.icon] ?? Trophy;
}
function isHidden(a: AchievementState): boolean {
  return a.secret && !a.unlocked;
}
function progressPct(a: AchievementState): number {
  if (a.threshold <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((a.value / a.threshold) * 100)));
}
function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
</script>

<template>
  <!-- No own scroller in the modal: WoodFrame already scrolls, so this would double the scrollbar. -->
  <div :class="embeddedWindowed ? 'px-4 sm:px-6 py-5' : 'min-h-screen bg-parchment'">
    <div :class="embeddedWindowed ? '' : 'max-w-4xl mx-auto px-4 pb-12 pt-6'">
      <div v-if="embeddedWindowed" class="flex items-center justify-between gap-4 w-full flex-wrap mb-4">
        <button
          type="button"
          class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
          @click="goBack"
        >
          <ChevronLeft :size="16" /> {{ $t("achievements.back_to_farm") }}
        </button>
        <a
          href="/achievements"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
        >
          {{ $t("achievements.open_in_new_tab") }}
          <ExternalLink :size="14" />
        </a>
      </div>
      <button
        v-else
        type="button"
        class="text-sm text-ds-brown underline flex items-center gap-1 mb-4 w-fit"
        @click="goBack"
      >
        <ChevronLeft :size="16" /> {{ $t("achievements.back_to_farm") }}
      </button>

      <template v-if="isLoggedIn">
        <div class="pb-6 mb-6 border-b-2 border-ds-brown">
          <div class="flex items-center gap-3 mb-3">
            <Trophy class="w-7 h-7 text-ds-brown" />
            <div>
              <h1 class="text-2xl font-bold text-ds-brown">{{ $t("achievements.title") }}</h1>
              <p class="text-sm text-ds-brown/60">{{ $t("achievements.subtitle") }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-sm font-bold text-ds-brown mb-1">
            <span>{{ $t("achievements.progress", { unlocked: unlockedCount, total: totalCount }) }}</span>
            <span>{{ overallPct }}%</span>
          </div>
          <div class="h-3 bg-ds-brown/15 overflow-hidden border border-ds-brown/20">
            <div class="h-full bg-ds-success transition-[width] duration-500" :style="{ width: `${overallPct}%` }" />
          </div>
        </div>

        <div
          v-for="group in grouped"
          :key="group.category"
          class="pb-6 mb-6 border-b-2 border-ds-brown last:border-b-0 last:mb-0"
        >
          <h2 class="text-lg font-bold text-ds-brown mb-4">{{ $t(`achievements.category.${group.category}`) }}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              v-for="a in group.items"
              :key="a.key"
              class="flex items-start gap-3 border-2 p-3"
              :class="a.unlocked ? 'border-ds-success bg-ds-success/5' : 'border-ds-brown/20 bg-ds-brown/5'"
            >
              <div
                class="shrink-0 w-11 h-11 flex items-center justify-center border-2"
                :class="a.unlocked ? 'border-ds-success text-ds-success' : 'border-ds-brown/30 text-ds-brown/40'"
              >
                <component :is="iconFor(a)" class="w-6 h-6" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-bold text-ds-brown text-sm" :class="{ 'opacity-60': !a.unlocked }">
                  {{ isHidden(a) ? $t("achievements.secret_name") : $t(`achievements.items.${a.key}.name`) }}
                </h3>
                <p class="text-xs text-ds-brown/60 leading-snug mt-0.5">
                  {{ isHidden(a) ? $t("achievements.secret_desc") : $t(`achievements.items.${a.key}.desc`) }}
                </p>
                <div v-if="!isHidden(a)" class="mt-2">
                  <div v-if="!a.unlocked" class="h-1.5 bg-ds-brown/15 overflow-hidden">
                    <div class="h-full bg-ds-brown/50 transition-[width] duration-500" :style="{ width: `${progressPct(a)}%` }" />
                  </div>
                  <p v-if="a.unlocked" class="text-[11px] font-bold text-ds-success">
                    {{ $t("achievements.unlocked_on", { date: formatDate(a.unlocked_at) }) }}
                  </p>
                  <p v-else class="text-[11px] text-ds-brown/45 mt-0.5">
                    {{ Math.min(a.value, a.threshold) }} / {{ a.threshold }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="flex flex-col items-center gap-3 py-10 text-center">
        <Trophy class="w-10 h-10 text-ds-brown/50" />
        <p class="text-ds-brown font-semibold">{{ $t("achievements.sign_in_prompt") }}</p>
        <button class="ds-btn-primary" @click="signIn">{{ $t("achievements.sign_in_cta") }}</button>
      </div>
    </div>
  </div>
</template>
