<script setup lang="ts">
import { BaseEdge, getBezierPath, Position } from "@vue-flow/core";
import { computed } from "vue";

type EdgeData = {
  label?: string;
  dashed?: boolean;
};

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: EdgeData;
  markerEnd?: string;
}>();

// same-side loop edges collapse to a straight line under getBezierPath, so draw a wide bow
const path = computed(() => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  if (sourcePosition === Position.Left && targetPosition === Position.Left) {
    const bow = Math.max(120, Math.abs(sourceY - targetY) * 0.35);
    return `M ${sourceX} ${sourceY} C ${sourceX - bow} ${sourceY} ${targetX - bow} ${targetY} ${targetX} ${targetY}`;
  }
  if (sourcePosition === Position.Right && targetPosition === Position.Right) {
    const bow = Math.max(120, Math.abs(sourceY - targetY) * 0.35);
    return `M ${sourceX} ${sourceY} C ${sourceX + bow} ${sourceY} ${targetX + bow} ${targetY} ${targetX} ${targetY}`;
  }

  // end exactly on the handle so edges sharing a target show one arrowhead, not two
  const [d] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return d;
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :style="{
      stroke: '#684D3A',
      strokeWidth: 3.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeDasharray: data?.dashed ? '8 7' : 'none',
      fill: 'none',
    }"
    :marker-end="markerEnd"
  />
</template>
