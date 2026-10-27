<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from "lucide-vue-next";

interface CalendarDay {
  day: string;
  status: "pending" | "active" | "frozen" | "missed" | "review_protected";
  seconds_logged: number;
  had_journal: boolean;
  frozen_by_other_project: boolean;
}

interface CalendarResponse {
  month: string;
  timezone: string;
  days: CalendarDay[];
}

const props = defineProps<{ projectId?: number }>();

const { user } = useAuth();
const { t } = useI18n();

// streak_days are keyed by the user's local day, so today/future must use that zone;
// UTC made the grid read a day behind for users east of UTC.
function localDayKey(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// the calendar response echoes users.timezone and wins once loaded
function resolveTz(): string {
  return data.value?.timezone || user.value?.timezone || "UTC";
}

function todayMonth(): string {
  return localDayKey(user.value?.timezone || "UTC").slice(0, 7);
}

const month = ref(todayMonth());
const data = ref<CalendarResponse | null>(null);
const loading = ref(false);
const projectInitialFetch = ref(!!props.projectId);
const skipNextMonthFetch = ref(false);

async function fetchMonth(m: string) {
  loading.value = true;
  try {
    data.value = await $fetch<CalendarResponse>(
      props.projectId
        ? `/api/projects/${props.projectId}/streak-calendar`
        : "/api/streaks/calendar",
      { params: projectInitialFetch.value ? undefined : { month: m } },
    );
    if (projectInitialFetch.value) {
      skipNextMonthFetch.value = true;
      month.value = data.value.month;
      projectInitialFetch.value = false;
    }
  } catch {
    data.value = { month: m, timezone: "UTC", days: [] };
  } finally {
    loading.value = false;
  }
}

function shiftMonth(delta: number) {
  const [y, m] = month.value.split("-").map(Number) as [number, number];
  month.value = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

const monthDate = computed(() => {
  const [y, m] = month.value.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1));
});

const heading = computed(() =>
  monthDate.value.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
);

const cells = computed(() => {
  const [y, m] = month.value.split("-").map(Number) as [number, number];
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map<string, CalendarDay>();
  for (const d of data.value?.days ?? []) byDay.set(d.day, d);
  const today = localDayKey(resolveTz());

  const cells: Array<
    | { kind: "blank"; key: string }
    | {
        kind: "day";
        key: string;
        day: string;
        dayNum: number;
        status: CalendarDay["status"] | "future" | "empty";
        secondsLogged: number;
        hadJournal: boolean;
        frozenByOtherProject: boolean;
      }
  > = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ kind: "blank", key: `b${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const row = byDay.get(dayStr);
    let status: CalendarDay["status"] | "future" | "empty";
    if (dayStr > today) status = "future";
    else if (row) status = row.status;
    else status = "empty";
    cells.push({
      kind: "day",
      key: dayStr,
      day: dayStr,
      dayNum: d,
      status,
      secondsLogged: row?.seconds_logged ?? 0,
      hadJournal: row?.had_journal ?? false,
      frozenByOtherProject: row?.frozen_by_other_project ?? false,
    });
  }
  return cells;
});

function cellClasses(c: { status: string; secondsLogged: number }): string {
  switch (c.status) {
    case "active":
      return activeIntensityClasses(Math.round(c.secondsLogged / 60));
    case "frozen":
      return "bg-cyan-400 text-cyan-900 border-cyan-700";
    case "review_protected":
      return "bg-cyan-200 text-cyan-900 border-cyan-600";
    case "missed":
      return "bg-ds-brown/30 text-ds-brown/60 border-ds-brown/40";
    case "pending":
      return "bg-yellow-200/60 text-ds-brown border-yellow-600/40";
    case "future":
      return "bg-transparent text-ds-brown/40 border-ds-brown/15 border-dashed";
    default:
      return "bg-ds-brown/5 text-ds-brown/40 border-ds-brown/15";
  }
}

// heatmap by minutes logged; stays in the orange family to match the streak UI
function activeIntensityClasses(minutes: number): string {
  if (minutes >= 480) return "bg-orange-700 text-white border-orange-800";
  if (minutes >= 240) return "bg-orange-600 text-white border-orange-800";
  if (minutes >= 120) return "bg-orange-500 text-white border-orange-700";
  if (minutes >= 60) return "bg-orange-400 text-orange-950 border-orange-600";
  // sub-hour active rows are rare journal-only edge cases
  return "bg-orange-300 text-orange-950 border-orange-500";
}

function cellTitle(c: {
  status: string;
  day: string;
  secondsLogged: number;
  hadJournal: boolean;
  frozenByOtherProject: boolean;
}): string {
  const m = Math.round(c.secondsLogged / 60);
  switch (c.status) {
    case "active":
      return c.hadJournal
        ? t("profile.streak_calendar.tooltip_active_journal", { day: c.day })
        : t("profile.streak_calendar.tooltip_active_seconds", { day: c.day, minutes: m });
    case "frozen":
      return c.frozenByOtherProject
        ? t("profile.streak_calendar.tooltip_frozen_by_other_project", { day: c.day })
        : t("profile.streak_calendar.tooltip_frozen", { day: c.day });
    case "review_protected":
      return t("profile.streak_calendar.tooltip_review_protected", { day: c.day });
    case "missed":
      return t("profile.streak_calendar.tooltip_missed", { day: c.day });
    case "pending":
      return t("profile.streak_calendar.tooltip_pending", { day: c.day, minutes: m });
    case "future":
      return c.day;
    default:
      return c.day;
  }
}

const weekdayLabels = computed(() => {
  const base = new Date(Date.UTC(2024, 5, 2));
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    out.push(
      d.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }),
    );
  }
  return out;
});

// the streak day rolls at local midnight; this keeps the {tz, formatted} i18n shape
const localStreakRollLabel = computed(() => {
  return { tz: data.value?.timezone || user.value?.timezone || "UTC", formatted: "midnight" };
});

watch(month, async (m) => {
  if (skipNextMonthFetch.value) {
    skipNextMonthFetch.value = false;
    return;
  }
  await fetchMonth(m);
}, { immediate: true });

watch(
  () => user.value?.id,
  () => {
    if (user.value) void fetchMonth(month.value);
  },
);

defineExpose({
  refresh: () => fetchMonth(month.value),
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <button
        type="button"
        class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-30"
        :disabled="loading"
        :aria-label="$t('profile.streak_calendar.prev_month')"
        @click="shiftMonth(-1)"
      >
        <ChevronLeft :size="18" />
      </button>
      <span class="text-sm font-bold text-ds-brown">{{ heading }}</span>
      <button
        type="button"
        class="p-1 text-ds-brown/60 hover:text-ds-brown disabled:opacity-30"
        :disabled="loading || month >= todayMonth()"
        :aria-label="$t('profile.streak_calendar.next_month')"
        @click="shiftMonth(1)"
      >
        <ChevronRight :size="18" />
      </button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-[10px] text-ds-brown/40 text-center">
      <span v-for="w in weekdayLabels" :key="w">{{ w }}</span>
    </div>
    <div class="grid grid-cols-7 gap-1">
      <template v-for="c in cells" :key="c.key">
        <div v-if="c.kind === 'blank'" class="aspect-square" />
        <div
          v-else
          :title="cellTitle(c)"
          :class="['aspect-square flex items-center justify-center text-[11px] font-semibold border-2 transition-colors', cellClasses(c)]"
        >
          {{ c.dayNum }}
        </div>
      </template>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ds-brown/60 mt-1">
      <span class="inline-flex items-center gap-1">
        <span class="w-3 h-3 bg-orange-500 border border-orange-700 inline-block" />
        <StreakFlame class="w-2.5 h-2.5 -ml-0.5" />
        {{ $t("profile.streak_calendar.legend_active") }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="w-3 h-3 bg-cyan-400 border border-cyan-700 inline-block" />
        <StreakFlame frozen class="w-2.5 h-2.5 -ml-0.5" />
        {{ $t("profile.streak_calendar.legend_frozen") }}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="w-3 h-3 bg-ds-brown/30 border border-ds-brown/40 inline-block" />
        <X :size="10" class="-ml-0.5" />
        {{ $t("profile.streak_calendar.legend_missed") }}
      </span>
    </div>
    <div class="flex items-center gap-1.5 text-[11px] text-ds-brown/55">
      <span>{{ $t("profile.streak_calendar.legend_intensity") }}</span>
      <span class="w-3 h-3 bg-orange-300 border border-orange-500 inline-block" />
      <span class="w-3 h-3 bg-orange-400 border border-orange-600 inline-block" />
      <span class="w-3 h-3 bg-orange-500 border border-orange-700 inline-block" />
      <span class="w-3 h-3 bg-orange-600 border border-orange-800 inline-block" />
      <span class="w-3 h-3 bg-orange-700 border border-orange-800 inline-block" />
    </div>
    <p
      class="text-[11px] text-ds-brown/60 leading-snug mt-1"
      :title="$t('profile.streak_calendar.utc_anchor_explainer_full')"
    >
      {{
        $t("profile.streak_calendar.utc_anchor_hint", {
          local: localStreakRollLabel.formatted,
          tz: localStreakRollLabel.tz,
        })
      }}
    </p>
  </div>
</template>
