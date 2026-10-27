<script setup lang="ts">
type BarRow = { label: string; value: number; secondary?: number | null };

const props = defineProps<{
  rows: BarRow[];
  emptyText?: string;
}>();

const max = computed(() =>
  props.rows.reduce((m, r) => Math.max(m, r.value), 0),
);

function barWidth(value: number): string {
  if (max.value <= 0) return "0%";
  return `${Math.max(2, Math.round((value / max.value) * 100))}%`;
}
</script>

<template>
  <div class="flex flex-col">
    <div
      v-if="!rows.length"
      class="py-8 text-center text-sm text-zinc-600"
    >
      {{ emptyText ?? "No data in this range." }}
    </div>
    <div
      v-for="(row, i) in rows"
      v-else
      :key="`${row.label}-${i}`"
      class="relative flex items-center justify-between gap-3 px-2 py-1.5 text-sm border-b border-zinc-800/50 last:border-b-0"
    >
      <div
        class="absolute inset-y-0.5 left-0 bg-sky-500/10"
        :style="{ width: barWidth(row.value) }"
      />
      <span class="relative z-10 truncate text-zinc-200" :title="row.label">
        {{ row.label }}
      </span>
      <span class="relative z-10 flex items-center gap-3 tabular-nums shrink-0">
        <span v-if="row.secondary != null" class="text-xs text-zinc-500">
          {{ row.secondary.toLocaleString() }}
        </span>
        <span class="font-semibold text-white">{{ row.value.toLocaleString() }}</span>
      </span>
    </div>
  </div>
</template>
