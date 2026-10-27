<script setup lang="ts">
import { Target, TrendingUp, Trophy } from "lucide-vue-next";
import type { ChartData, ChartOptions, TooltipItem } from "chart.js";
import type { Component } from "vue";

// chart.js is lazy-loaded client-side; SSR renders nothing here
const Line = ref<Component | null>(null);
onMounted(async () => {
  const [chartJs, vueChartjs] = await Promise.all([
    import("chart.js"),
    import("vue-chartjs"),
  ]);
  chartJs.Chart.register(
    chartJs.LineElement,
    chartJs.PointElement,
    chartJs.LinearScale,
    chartJs.CategoryScale,
    chartJs.Tooltip,
    chartJs.Filler,
  );
  Line.value = vueChartjs.Line as unknown as Component;
});

interface TrendDay {
  day: string;
  status: "pending" | "active" | "frozen" | "missed" | "review_protected";
  seconds_logged: number;
  had_journal: boolean;
}
interface TrendsResponse {
  start_day: string;
  end_day: string;
  window_days: number;
  timezone: string;
  days: TrendDay[];
}

const { t } = useI18n();

const data = ref<TrendsResponse | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await $fetch<TrendsResponse>("/api/streaks/trends", {
      params: { days: 30 },
    });
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
defineExpose({ refresh: load });

const GOAL_MINUTES = 60;

// zero-fill gaps: the API only returns days that have a row
const series = computed(() => {
  const res = data.value;
  if (!res) return [] as Array<{ day: string; minutes: number; metGoal: boolean }>;
  const byDay = new Map(res.days.map((d) => [d.day, d]));
  const out: Array<{ day: string; minutes: number; metGoal: boolean }> = [];
  const start = new Date(`${res.start_day}T00:00:00Z`);
  for (let i = 0; i < res.window_days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (key > res.end_day) break;
    const minutes = Math.round((byDay.get(key)?.seconds_logged ?? 0) / 60);
    out.push({ day: key, minutes, metGoal: minutes >= GOAL_MINUTES });
  }
  return out;
});

const avgMinutes = computed(() => {
  const s = series.value;
  if (!s.length) return 0;
  return Math.round(s.reduce((sum, d) => sum + d.minutes, 0) / s.length);
});
const best = computed(() => {
  let minutes = 0;
  let day = "";
  for (const d of series.value) {
    if (d.minutes > minutes) {
      minutes = d.minutes;
      day = d.day;
    }
  }
  return { minutes, day };
});
const consistencyPct = computed(() => {
  const s = series.value;
  if (!s.length) return 0;
  return Math.round((s.filter((d) => d.metGoal).length / s.length) * 100);
});
const longestRun = computed(() => {
  let run = 0;
  let cur = 0;
  for (const d of series.value) {
    if (d.metGoal) {
      cur += 1;
      run = Math.max(run, cur);
    } else {
      cur = 0;
    }
  }
  return run;
});
const hasData = computed(() => series.value.some((d) => d.minutes > 0));

function fmtMinutes(m: number): string {
  if (m < 60) return t("profile.streak_trends.minutes_short", { m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0
    ? t("profile.streak_trends.hours_short", { h })
    : t("profile.streak_trends.hours_minutes_short", { h, m: rem });
}
function fmtShortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// the goal line is a flat dataset because the annotation plugin isn't bundled
const chartData = computed<ChartData<"line">>(() => ({
  labels: series.value.map((d) => d.day),
  datasets: [
    {
      label: "minutes",
      data: series.value.map((d) => d.minutes),
      borderColor: "#684D3A",
      backgroundColor: "rgba(104, 77, 58, 0.12)",
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: "#684D3A",
      pointHoverBorderColor: "#F6E5C7",
    },
    {
      label: "goal",
      data: series.value.map(() => GOAL_MINUTES),
      borderColor: "rgba(145, 161, 96, 0.85)",
      borderDash: [5, 4],
      borderWidth: 1.5,
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 0,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "#684D3A",
      titleColor: "#F6E5C7",
      bodyColor: "#F6E5C7",
      cornerRadius: 0,
      displayColors: false,
      filter: (item: TooltipItem<"line">) => item.datasetIndex === 0,
      callbacks: {
        title: (items: TooltipItem<"line">[]) =>
          items[0] ? fmtShortDay(String(items[0].label)) : "",
        label: (item: TooltipItem<"line">) => fmtMinutes(Math.round(item.parsed.y ?? 0)),
      },
    },
  },
  scales: {
    x: { display: false, grid: { display: false } },
    y: {
      beginAtZero: true,
      grid: { color: "rgba(104, 77, 58, 0.1)" },
      ticks: {
        color: "rgba(104, 77, 58, 0.5)",
        maxTicksLimit: 4,
        callback: (value: number | string) => `${value}m`,
      },
    },
  },
}));
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading && !data" class="text-sm text-ds-brown/55 italic">
      {{ $t("profile.streak_trends.loading") }}
    </div>
    <template v-else>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="border-2 border-ds-brown/20 bg-ds-brown/5 p-2.5 flex flex-col gap-0.5">
          <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ds-brown/50">
            <TrendingUp class="w-3 h-3" /> {{ $t("profile.streak_trends.avg_per_day") }}
          </span>
          <span class="text-lg font-bold text-ds-brown">{{ fmtMinutes(avgMinutes) }}</span>
        </div>
        <div class="border-2 border-ds-brown/20 bg-ds-brown/5 p-2.5 flex flex-col gap-0.5">
          <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ds-brown/50">
            <StreakFlame class="w-3 h-3" /> {{ $t("profile.streak_trends.best_day") }}
          </span>
          <span class="text-lg font-bold text-ds-brown">{{ best.minutes > 0 ? fmtMinutes(best.minutes) : "-" }}</span>
          <span v-if="best.minutes > 0" class="text-[10px] text-ds-brown/50">{{ fmtShortDay(best.day) }}</span>
        </div>
        <div class="border-2 border-ds-brown/20 bg-ds-brown/5 p-2.5 flex flex-col gap-0.5">
          <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ds-brown/50">
            <Target class="w-3 h-3" /> {{ $t("profile.streak_trends.consistency") }}
          </span>
          <span class="text-lg font-bold text-ds-brown">{{ consistencyPct }}%</span>
        </div>
        <div class="border-2 border-ds-brown/20 bg-ds-brown/5 p-2.5 flex flex-col gap-0.5">
          <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ds-brown/50">
            <Trophy class="w-3 h-3" /> {{ $t("profile.streak_trends.longest_run") }}
          </span>
          <span class="text-lg font-bold text-ds-brown">{{ $t("profile.streak_trends.days_count", { count: longestRun }) }}</span>
        </div>
      </div>

      <div v-if="hasData" class="border-2 border-ds-brown/20 bg-white/40 p-3">
        <div class="h-36" role="img" :aria-label="$t('profile.streak_trends.chart_aria')">
          <ClientOnly>
            <component :is="Line" v-if="Line" :data="chartData" :options="chartOptions" />
          </ClientOnly>
        </div>
        <p class="flex items-center gap-1.5 text-[10px] text-ds-brown/45 mt-1.5">
          <span class="w-4 border-t border-dashed border-ds-success inline-block" />
          {{ $t("profile.streak_trends.goal_line") }}
        </p>
      </div>
      <p v-else class="text-sm text-ds-brown/55 italic">
        {{ $t("profile.streak_trends.empty") }}
      </p>
    </template>
  </div>
</template>
