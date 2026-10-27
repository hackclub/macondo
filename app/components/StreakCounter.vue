<script setup lang="ts">
const { user } = useAuth();
const { t } = useI18n();

function openStreakSection() {
  void navigateTo({ path: "/profile", hash: "#streak" });
}

const freezes = computed(() => user.value?.streak_freezes_remaining ?? 0);
const longestStreak = computed(() => user.value?.longest_current_streak ?? 0);

// shared state: one fetch per dashboard load, not one per surface
const { todaySeconds, goalSeconds, workedToday: streakWorkedToday, initialized, refresh: refreshStreakToday } = useStreakToday();
// session value only until the live fetch resolves, so the flame never flashes cold
const workedToday = computed(() =>
  initialized.value ? streakWorkedToday.value : (user.value?.worked_today ?? false),
);
onMounted(() => {
  if (!initialized.value) void refreshStreakToday();
});
const todayProgress = computed(() => {
  return Math.max(0, Math.min(1, todaySeconds.value / (goalSeconds.value || 3600))); // default daily goal of one hour
});
// hidden at 1 because the lit flame already says the goal is met
const showTodayProgress = computed(
  () => todayProgress.value > 0 && todayProgress.value < 1,
);
const todayMinutes = computed(() => Math.floor(todaySeconds.value / 60));
const goalMinutes = computed(() => Math.round((goalSeconds.value || 3600) / 60)); // default daily goal of one hour

const state = computed<"lit" | "protected" | "cold">(() => {
  if (workedToday.value) return "lit";
  if (freezes.value > 0) return "protected";
  return "cold";
});

const tooltip = computed(() => {
  if (state.value === "lit") return t("streak_counter.lit");
  if (state.value === "protected") return t("streak_counter.protected", { count: freezes.value });
  return t("streak_counter.cold");
});

const showCard = ref(false);
const sparkFetched = ref(false);
let sparkInFlight = false;
const sparkDays = ref<Array<{ day: string; minutes: number }>>([]);

async function loadSpark() {
  if (sparkFetched.value || sparkInFlight) return;
  sparkInFlight = true;
  try {
    const res = await $fetch<{
      start_day: string;
      end_day: string;
      window_days: number;
      days: Array<{ day: string; seconds_logged: number }>;
    }>("/api/streaks/trends", { params: { days: 14 } });
    const byDay = new Map(res.days.map((d) => [d.day, d.seconds_logged]));
    const out: Array<{ day: string; minutes: number }> = [];
    const start = new Date(`${res.start_day}T00:00:00Z`);
    for (let i = 0; i < res.window_days; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      if (key > res.end_day) break;
      out.push({ day: key, minutes: Math.round((byDay.get(key) ?? 0) / 60) });
    }
    sparkDays.value = out;
    sparkFetched.value = true;
  } catch {
    // allow a retry on the next hover
  } finally {
    sparkInFlight = false;
  }
}

function onEnter() {
  showCard.value = true;
  void loadSpark();
}

const hasSpark = computed(() => sparkDays.value.some((d) => d.minutes > 0));

// soft 4-hour (240 min) cap so one long day doesn't flatten the rest
function barHeight(minutes: number): number {
  return Math.max(minutes > 0 ? 10 : 3, Math.min(100, (minutes / 240) * 100)); // min bar heights so every day stays visible
}
function barColor(minutes: number): string {
  if (minutes >= 240) return "#c2410c";
  if (minutes >= 120) return "#ea580c";
  if (minutes >= 60) return "#f97316";
  if (minutes > 0) return "#fdba74";
  return "#6b534022";
}
</script>

<template>
  <div class="relative" @mouseenter="onEnter" @mouseleave="showCard = false">
    <button
      type="button"
      :title="tooltip"
      :aria-label="tooltip"
      class="relative overflow-hidden flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown hover:bg-parchment transition-colors focus:outline-none focus:ring-2 focus:ring-ds-brown/40"
      @click="openStreakSection"
    >
      <StreakFlame :frozen="state === 'protected'" :dim="state === 'cold'" class="w-5 h-5 md:w-6 md:h-6" />
      <span class="text-xs sm:text-sm md:text-base font-bold text-ds-brown">{{ longestStreak }}</span>
      <div
        v-if="showTodayProgress"
        class="absolute bottom-0 left-0 h-1 bg-orange-500/80 transition-[width] duration-500"
        :style="{ width: `${Math.round(todayProgress * 100)}%` }"
      />
    </button>

    <Transition name="streak-card">
      <!-- pt-2 is a hover bridge so the card stays open across the gap -->
      <div v-if="showCard" class="absolute top-full left-0 z-50 pt-2">
        <div class="w-60 bg-parchment border-[3px] border-ds-brown p-3 shadow-xl">
          <div class="flex items-center justify-between text-xs font-bold text-ds-brown mb-1">
            <span class="flex items-center gap-1">
              <StreakFlame :frozen="state === 'protected'" :dim="state === 'cold'" class="w-3.5 h-3.5" /> {{ $t("streak_counter.card_today") }}
            </span>
            <span>{{ $t("streak_counter.card_minutes", { minutes: todayMinutes, goal: goalMinutes }) }}</span>
          </div>
          <div class="h-2 bg-ds-brown/15 border border-ds-brown/20 overflow-hidden">
            <div
              class="h-full transition-[width] duration-500"
              :class="todayProgress >= 1 ? 'bg-ds-success' : 'bg-orange-500'"
              :style="{ width: `${Math.round(todayProgress * 100)}%` }"
            />
          </div>

          <div class="mt-3">
            <span class="text-[10px] uppercase tracking-wide font-bold text-ds-brown/50">{{ $t("streak_counter.card_recent") }}</span>
            <div v-if="hasSpark" class="flex items-end gap-0.5 h-10 mt-1">
              <div
                v-for="d in sparkDays"
                :key="d.day"
                :title="$t('streak_counter.card_minutes_short', { minutes: d.minutes })"
                class="flex-1 min-w-0"
                :style="{ height: `${barHeight(d.minutes)}%`, background: barColor(d.minutes) }"
              />
            </div>
            <p v-else class="text-[11px] text-ds-brown/50 italic mt-1">{{ $t("streak_counter.card_empty") }}</p>
          </div>

          <p class="mt-2 text-[10px] leading-snug text-ds-brown/55">
            {{ $t("streak_counter.card_scope") }}
          </p>

          <button
            type="button"
            class="mt-3 w-full text-[11px] font-semibold text-ds-brown/70 hover:text-ds-brown underline"
            @click="openStreakSection"
          >
            {{ $t("streak_counter.card_view") }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.streak-card-enter-active,
.streak-card-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.streak-card-enter-from,
.streak-card-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
