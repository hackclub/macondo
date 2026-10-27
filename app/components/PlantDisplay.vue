<script setup lang="ts">
import { fruits as fruitData } from "~/data/fruitLevels";

const props = defineProps<{
  fruit: string;
  stage: number;
}>();

// Same display config as GameWorld. Per-fruit, per-stage: [size, bottomPx, clipBottomPercent]
const fruitDisplayConfig: Record<string, [number, number, number][]> = {
  Mango:    [[70, 5, 0], [110, 0, 20], [120, 0, 20], [130, -10, 0]],
  Guava:    [[55, 2, 0], [85, -8, 0], [100, -15, 0], [115, -20, 0]],
  Cocoa:    [[50, 10, 0], [80, 5, 0], [100, 0, 0], [120, -8, 0]],
  Avocado:  [[60, 5, 0], [90, 0, 0], [110, -5, 0], [130, -10, 0]],
  Coconut:  [[45, 10, 0], [60, 8, 0], [75, 5, 0], [95, 5, 0]],
  Papaya:   [[60, 5, 0], [85, 0, 0], [100, -3, 0], [115, -5, 0]],
  Pineapple:  [[55, 10, 0], [70, 8, 0], [85, 5, 0], [100, 5, 0]],
  Watermelon: [[55, 10, 0], [70, 8, 0], [85, 5, 0], [100, 5, 0]],
};

const fruitObj = computed(() => fruitData.find(f => f.name === props.fruit) ?? null);

const stageImage = computed(() => {
  if (!fruitObj.value || fruitObj.value.stages.length === 0) return null;
  return fruitObj.value.stages[Math.min(Math.max((props.stage || 1) - 1, 0), fruitObj.value.stages.length - 1)] ?? null;
});

const display = computed(() => {
  const s = Math.min(Math.max(props.stage || 1, 1), 4);
  const config = fruitDisplayConfig[props.fruit];
  if (config) {
    const [size, bottom, clipBottom] = config[s - 1]!;
    return { size, bottom, clipBottom };
  }
  return { size: [65, 85, 105, 130][s - 1] ?? 85, bottom: 10, clipBottom: 0 };
});
</script>

<template>
  <div class="plant-display">
    <img
      v-if="stageImage"
      :src="stageImage"
      :alt="fruit"
      class="fruit-sprite"
      :style="{
        width: display.size * 0.8 + 'px',
        height: display.size * 0.8 + 'px',
        clipPath: display.clipBottom ? `inset(0 0 ${display.clipBottom}% 0)` : undefined,
      }"
    >
  </div>
</template>

<style scoped>
.plant-display {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  flex-shrink: 0;
}

.fruit-sprite {
  object-fit: contain;
  object-position: bottom;
  filter: drop-shadow(2px 6px 4px rgba(0, 0, 0, 0.3));
}
</style>
