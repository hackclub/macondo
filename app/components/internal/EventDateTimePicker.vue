<script setup lang="ts">
// modelValue is wall-clock "YYYY-MM-DDTHH:mm" (or ""), read in the event's timezone

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    placeholder?: string;
    clearable?: boolean;
    min?: string;
  }>(),
  { placeholder: "Select date and time", clearable: false, min: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function todayMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// events can't be scheduled in the past
const minDate = computed(() => {
  const today = todayStr();
  const minProp = props.min ? props.min.split("T")[0] ?? "" : "";
  return minProp && minProp > today ? minProp : today;
});
const minMonth = computed(() => minDate.value.slice(0, 7));
const canGoPrev = computed(() => currentMonth.value > minMonth.value);

const datePart = computed(() => props.modelValue.split("T")[0] ?? "");
const timePart = computed(() => props.modelValue.split("T")[1] ?? "");

const currentMonth = ref(datePart.value ? datePart.value.slice(0, 7) : todayMonth());
watch(
  () => props.modelValue,
  (v) => {
    const d = v.split("T")[0];
    if (d) currentMonth.value = d.slice(0, 7);
  },
);

function shiftMonth(delta: number): void {
  if (delta < 0 && !canGoPrev.value) return;
  const y = Number(currentMonth.value.slice(0, 4));
  const m = Number(currentMonth.value.slice(5, 7));
  if (Number.isNaN(y) || Number.isNaN(m)) return;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  currentMonth.value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (Number.isNaN(y) || Number.isNaN(m)) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function firstWeekday(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (Number.isNaN(y) || Number.isNaN(m)) return 0;
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

type Cell = { key: string; date: string | null; day: number; disabled: boolean };
const cells = computed<Cell[]>(() => {
  const out: Cell[] = [];
  const lead = firstWeekday(currentMonth.value);
  for (let i = 0; i < lead; i += 1) {
    out.push({ key: `l${i}`, date: null, day: 0, disabled: true });
  }
  const total = daysInMonth(currentMonth.value);
  for (let day = 1; day <= total; day += 1) {
    const date = `${currentMonth.value}-${pad(day)}`;
    out.push({ key: date, date, day, disabled: date < minDate.value });
  }
  const trail = (7 - (out.length % 7)) % 7;
  for (let i = 0; i < trail; i += 1) {
    out.push({ key: `t${i}`, date: null, day: 0, disabled: true });
  }
  return out;
});

function pickDay(date: string): void {
  if (date < minDate.value) return;
  emit("update:modelValue", `${date}T${timePart.value || "12:00"}`);
}
function onTime(e: Event): void {
  const time = (e.target as HTMLInputElement).value;
  if (datePart.value) emit("update:modelValue", `${datePart.value}T${time}`);
}
function clear(): void {
  emit("update:modelValue", "");
  open.value = false;
}
function toggleOpen(): void {
  open.value = !open.value;
}

function formatLabel(v: string): string {
  if (!v) return "";
  const [d, t] = v.split("T");
  const parsed = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return v;
  const dl = parsed.toLocaleDateString([], {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return t ? `${dl}, ${t}` : dl;
}
function monthLabel(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? month
    : parsed.toLocaleDateString([], { timeZone: "UTC", month: "long", year: "numeric" });
}
</script>

<template>
  <div class="flex flex-col gap-1 text-xs">
    <span class="text-zinc-500 font-bold uppercase tracking-widest">{{ label }}</span>
    <button
      type="button"
      class="h-9 w-full bg-zinc-950 border border-zinc-800 px-3 text-left text-zinc-200 focus:outline-none focus:border-cyan-500/50 flex items-center justify-between gap-2"
      @click="toggleOpen"
    >
      <span class="truncate">{{ modelValue ? formatLabel(modelValue) : placeholder }}</span>
      <CalendarDays :size="15" class="text-zinc-500 shrink-0" />
    </button>

    <div v-if="open" class="border border-zinc-800 bg-zinc-950 p-3 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="h-7 w-7 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 flex items-center justify-center"
          :disabled="!canGoPrev"
          title="Previous month"
          @click="shiftMonth(-1)"
        >
          <ChevronLeft :size="16" />
        </button>
        <p class="text-[11px] font-bold text-zinc-200 uppercase tracking-widest text-center flex-1">
          {{ monthLabel(currentMonth) }}
        </p>
        <button
          type="button"
          class="h-7 w-7 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 flex items-center justify-center"
          title="Next month"
          @click="shiftMonth(1)"
        >
          <ChevronRight :size="16" />
        </button>
        <button
          v-if="clearable && modelValue"
          type="button"
          class="h-7 w-7 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 flex items-center justify-center"
          title="Clear"
          @click="clear"
        >
          <X :size="14" />
        </button>
      </div>

      <div class="grid grid-cols-7 gap-1 text-[10px] text-zinc-600 font-bold uppercase">
        <span
          v-for="(weekday, index) in weekdayLabels"
          :key="`${weekday}-${index}`"
          class="h-5 flex items-center justify-center"
        >
          {{ weekday }}
        </span>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <template v-for="cell in cells" :key="cell.key">
          <button
            v-if="cell.date"
            type="button"
            class="h-8 min-w-0 border text-[11px] font-bold transition-colors flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:bg-zinc-900/60"
            :class="cell.date === datePart
              ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:border-cyan-500/50 hover:bg-cyan-500/10'"
            :disabled="cell.disabled"
            @click="pickDay(cell.date)"
          >
            {{ cell.day }}
          </button>
          <div v-else class="h-8 border border-transparent" />
        </template>
      </div>

      <label class="flex items-center justify-between gap-2 border-t border-zinc-900 pt-2">
        <span class="text-zinc-500 font-bold uppercase tracking-widest">Time</span>
        <input
          :value="timePart"
          type="time"
          class="bg-black/30 border border-zinc-800 px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          @input="onTime"
        >
      </label>
    </div>
  </div>
</template>
