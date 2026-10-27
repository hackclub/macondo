<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";

type NodeData = {
  fruitSrc: string;
  titleKey: string;
  bodyKey: string;
  numberLabel: string;
  // keep handles minimal so vue flow can auto-measure quickly
  extraHandles?: Array<"right-source" | "left-source" | "left-target" | "bottom-target" | "right-target">;
};

defineProps<{
  id: string;
  data: NodeData;
}>();
</script>

<template>
  <div
    class="macondo-node bg-parchment border-[3px] border-ds-brown p-3 shadow-md"
    style="width: 220px; min-height: 90px; box-sizing: border-box;"
  >
    <!-- no ids, so these are the defaults for edges without sourceHandle/targetHandle -->
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />

    <template v-if="data.extraHandles?.includes('right-source')">
      <Handle id="right" type="source" :position="Position.Right" />
    </template>
    <template v-if="data.extraHandles?.includes('left-source')">
      <Handle id="left" type="source" :position="Position.Left" />
    </template>
    <template v-if="data.extraHandles?.includes('left-target')">
      <Handle id="left-in" type="target" :position="Position.Left" />
    </template>
    <template v-if="data.extraHandles?.includes('bottom-target')">
      <Handle id="bottom-in" type="target" :position="Position.Bottom" />
    </template>
    <template v-if="data.extraHandles?.includes('right-target')">
      <Handle id="right-in" type="target" :position="Position.Right" />
    </template>

    <div class="flex items-start gap-2">
      <img :src="data.fruitSrc" class="w-7 h-7 object-contain shrink-0" alt="">
      <div>
        <p class="font-satoro font-bold text-ds-brown text-sm leading-tight">
          {{ data.numberLabel }} {{ $t(data.titleKey) }}
        </p>
        <p class="text-[11px] text-ds-brown/80 leading-snug mt-0.5">
          {{ $t(data.bodyKey) }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide Vue Flow's handle dots, but keep them laid out so edges know where to attach. */
:deep(.vue-flow__handle) {
  opacity: 0;
  width: 8px;
  height: 8px;
  border: none;
  background: transparent;
}
</style>
