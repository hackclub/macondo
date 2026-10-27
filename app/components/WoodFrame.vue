<script setup lang="ts">
defineProps<{
  class?: string;
  noBg?: boolean;
}>();

// base images until mount so SSR and hydration match; random _2 variants after
const borders = ref({
  topLeft: '/images/borders/top_left.webp',
  topRight: '/images/borders/top_right.webp',
  bottomLeft: '/images/borders/bottom_left.webp',
  bottomRight: '/images/borders/bottom_right.webp',
});

onMounted(() => {
  const pick = (name: string) => `/images/borders/${name}${Math.random() > 0.5 ? '_2' : ''}.webp`;
  borders.value = {
    topLeft: pick('top_left'),
    topRight: pick('top_right'),
    bottomLeft: pick('bottom_left'),
    bottomRight: pick('bottom_right'),
  };
});
</script>

<template>
  <div class="relative pl-5 pt-4 pr-6 pb-6 flex flex-col" :class="$props.class">
    <div v-if="!noBg" class="absolute top-2 bottom-2 left-3 right-3 bg-parchment" />

    <div class="relative z-[1] flex-1 min-h-0 w-full" :class="noBg ? 'overflow-visible' : 'p-4 overflow-y-auto'">
      <slot />
    </div>

    <img :src="borders.topLeft" class="absolute top-0 left-0 w-24 h-24 pointer-events-none z-[2]" alt="" draggable="false">
    <img :src="borders.topRight" class="absolute top-0 right-0 w-24 h-24 pointer-events-none z-[2]" alt="" draggable="false">
    <img :src="borders.bottomLeft" class="absolute bottom-0 left-0 w-24 h-24 pointer-events-none z-[2]" alt="" draggable="false">
    <img :src="borders.bottomRight" class="absolute bottom-0 right-0 w-24 h-24 pointer-events-none z-[2]" alt="" draggable="false">

    <div
      class="absolute top-24 left-[8px] bottom-24 w-24 pointer-events-none z-[1]"
      :style="{ backgroundImage: 'url(/images/borders/left.webp)', backgroundSize: '96px 96px', backgroundRepeat: 'no-repeat round' }"
    />
    <div
      class="absolute top-24 right-[8px] bottom-24 w-24 pointer-events-none z-[1]"
      :style="{ backgroundImage: 'url(/images/borders/right.webp)', backgroundSize: '96px 96px', backgroundRepeat: 'no-repeat round' }"
    />

    <div
      class="absolute top-0 left-24 right-24 h-24 pointer-events-none z-[1]"
      :style="{ backgroundImage: 'url(/images/borders/top.webp)', backgroundSize: '100% 100%' }"
    />
    <div
      class="absolute bottom-0 left-24 right-24 h-24 pointer-events-none z-[1]"
      :style="{ backgroundImage: 'url(/images/borders/bottom.webp)', backgroundSize: '100% 100%' }"
    />
  </div>
</template>
