<script setup lang="ts">
import { Sun, SunMoon, Moon } from "lucide-vue-next";

const { mode, setMode, blend } = useNightMode();
const { t } = useI18n();

const allOptions = [
  { value: "day", icon: Sun, key: "night_mode.day" },
  { value: "auto", icon: SunMoon, key: "night_mode.auto" },
  { value: "night", icon: Moon, key: "night_mode.night" },
] as const;

const options = computed(() => {
  if (mode.value !== "auto") return allOptions;
  const isLight = blend.value < 0.5;
  return allOptions.filter((o) =>
    isLight ? o.value !== "day" : o.value !== "night",
  );
});
</script>

<template>
  <div
    class="flex items-stretch self-stretch border-[3px] border-ds-brown bg-parchment"
    role="group"
    :aria-label="t('night_mode.label')"
  >
    <button
      v-for="(opt, i) in options"
      :key="opt.value"
      type="button"
      class="flex items-center gap-1 px-2 py-1.5 md:px-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
      :class="[
        mode === opt.value
          ? 'bg-ds-cream text-ds-brown'
          : 'text-ds-brown/60 hover:text-ds-brown hover:bg-ds-cream/50',
        i > 0 ? 'border-l-[3px] border-ds-brown' : '',
      ]"
      :aria-pressed="mode === opt.value"
      :title="t(opt.key)"
      @click="setMode(opt.value)"
    >
      <component :is="opt.icon" class="w-3.5 h-3.5" :stroke-width="2.5" />
      <span class="hidden md:inline">{{ t(opt.key) }}</span>
    </button>
  </div>
</template>
