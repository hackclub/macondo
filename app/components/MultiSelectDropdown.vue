<script setup lang="ts">
import { ChevronDown } from "lucide-vue-next";

interface Option {
  value: number;
  label: string;
}
const props = withDefaults(
  defineProps<{
    modelValue: number[];
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "Select", disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [number[]] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const selectedLabels = computed(() =>
  props.options
    .filter((o) => props.modelValue.includes(o.value))
    .map((o) => o.label),
);
function isSelected(v: number) {
  return props.modelValue.includes(v);
}
function toggle(v: number) {
  emit(
    "update:modelValue",
    isSelected(v)
      ? props.modelValue.filter((x) => x !== v)
      : [...props.modelValue, v],
  );
}
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div ref="root" class="relative inline-block text-left">
    <button
      type="button"
      :disabled="disabled"
      class="flex items-center justify-between gap-2 min-w-[11rem] max-w-[18rem] border-[3px] border-ds-brown bg-white/70 px-3 py-1.5 text-sm text-ds-brown disabled:opacity-50"
      @click="open = !open"
    >
      <span class="truncate">
        <template v-if="selectedLabels.length">{{ selectedLabels.join(", ") }}</template>
        <span v-else class="text-ds-brown/50">{{ placeholder }}</span>
      </span>
      <ChevronDown
        :size="16"
        :stroke-width="2.5"
        :class="['shrink-0 transition-transform duration-150', open && 'rotate-180']"
      />
    </button>

    <div
      v-if="open"
      class="absolute z-30 left-0 mt-1 w-full max-h-60 overflow-y-auto border-[3px] border-ds-brown bg-ds-cream shadow-xl"
    >
      <label
        v-for="opt in options"
        :key="opt.value"
        class="flex items-center gap-2 px-3 py-1.5 text-sm text-ds-brown hover:bg-ds-brown/10 cursor-pointer select-none"
      >
        <input
          type="checkbox"
          class="w-4 h-4 accent-ds-brown shrink-0"
          :checked="isSelected(opt.value)"
          @change="toggle(opt.value)"
        >
        {{ opt.label }}
      </label>
    </div>
  </div>
</template>
