<script setup lang="ts">
export interface CarouselItem {
  key: string;
  label: string;
  icon?: string;
  sublabel?: string;
}

const props = withDefaults(defineProps<{
  items: CarouselItem[];
  modelValue: string;
  ariaLabel?: string;
}>(), {
  ariaLabel: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useI18n();

const groupLabel = computed(() => props.ariaLabel ?? t("carousel_picker.label"));

const currentIndex = computed(() => {
  const idx = props.items.findIndex(i => i.key === props.modelValue);
  return idx >= 0 ? idx : 0;
});

function prev() {
  emit('update:modelValue', props.items[(currentIndex.value - 1 + props.items.length) % props.items.length]!.key);
}

function next() {
  emit('update:modelValue', props.items[(currentIndex.value + 1) % props.items.length]!.key);
}

function onItemKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
    nextTick(() => focusSelected());
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    next();
    nextTick(() => focusSelected());
  } else if (e.key === "Home") {
    e.preventDefault();
    if (props.items[0]) emit('update:modelValue', props.items[0].key);
    nextTick(() => focusSelected());
  } else if (e.key === "End") {
    e.preventDefault();
    const last = props.items[props.items.length - 1];
    if (last) emit('update:modelValue', last.key);
    nextTick(() => focusSelected());
  }
}

const trackRef = ref<HTMLElement | null>(null);
function focusSelected() {
  trackRef.value?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
}

function getItemStyle(index: number) {
  const diff = index - currentIndex.value;
  const absDiff = Math.abs(diff);

  if (absDiff > 2) return { opacity: '0', pointerEvents: 'none' as const, transform: 'translateX(0) scale(0.5) rotateY(0deg)' };

  const translateX = diff * 90;
  const scale = 1 - absDiff * 0.2;
  const rotateY = diff * -25;
  const zIndex = 10 - absDiff;
  const opacity = 1 - absDiff * 0.3;

  return {
    transform: `translateX(${translateX}px) scale(${scale}) rotateY(${rotateY}deg)`,
    zIndex,
    opacity: String(opacity),
  };
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="groupLabel"
    class="relative flex items-center justify-center"
  >
    <button
      type="button"
      :aria-label="t('carousel_picker.previous')"
      class="absolute left-0 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-ds-brown text-ds-cream hover:bg-ds-brown/80 transition-colors"
      @click="prev"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>

    <div ref="trackRef" class="relative h-24 w-full overflow-hidden" style="perspective: 600px">
      <div
        v-for="(item, index) in items"
        :key="item.key"
        role="radio"
        :aria-checked="item.key === modelValue"
        :tabindex="item.key === modelValue ? 0 : -1"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-brown focus-visible:ring-offset-2"
        :style="getItemStyle(index)"
        @click="emit('update:modelValue', item.key)"
        @keydown="onItemKeydown"
      >
        <div
          class="flex flex-col items-center gap-1 px-5 py-3 border-[3px] transition-all duration-300 select-none whitespace-nowrap"
          :class="item.key === modelValue
            ? 'bg-ds-brown/10 border-ds-brown shadow-lg scale-100'
            : 'bg-white/60 border-ds-brown/20 shadow-sm'"
        >
          <img v-if="item.icon" :src="item.icon" class="w-8 h-8 object-contain" alt="">
          <span class="text-sm font-semibold text-ds-brown">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <button
      type="button"
      :aria-label="t('carousel_picker.next')"
      class="absolute right-0 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-ds-brown text-ds-cream hover:bg-ds-brown/80 transition-colors"
      @click="next"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>
</template>
