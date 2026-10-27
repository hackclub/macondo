<script setup lang="ts">
import { VueFlow, useVueFlow, MarkerType, type Node, type Edge } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import { markRaw, onMounted, onUnmounted, nextTick } from "vue";
import MacondoFlowNode from "./MacondoFlowNode.vue";
import MacondoFlowEdge from "./MacondoFlowEdge.vue";

const { updateNodeInternals, fitView } = useVueFlow();

// explicit width/height so the first paint doesn't wait on ResizeObserver measurement
const nodes: Node[] = [
  {
    id: "1",
    type: "macondo",
    position: { x: 270, y: 0 },
    data: { fruitSrc: "/images/fruits/avocado/icon_interior.webp", titleKey: "landing.flow.node1_title", bodyKey: "landing.flow.node1_body", numberLabel: "1." },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "2",
    type: "macondo",
    position: { x: 270, y: 140 },
    data: { fruitSrc: "/images/fruits/papaya/icon_interior.webp", titleKey: "landing.flow.node2_title", bodyKey: "landing.flow.node2_body", numberLabel: "2." },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "3a",
    type: "macondo",
    position: { x: 40, y: 400 },
    data: { fruitSrc: "/images/fruits/cocoa/icon_interior.webp", titleKey: "landing.flow.node3a_title", bodyKey: "landing.flow.node3a_body", numberLabel: "3a.", extraHandles: ["left-target"] },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    // software step 1, level with hardware 3a so the columns read as parallel paths
    id: "track",
    type: "macondo",
    position: { x: 500, y: 400 },
    data: { fruitSrc: "/images/fruits/pineapple/icon.webp", titleKey: "landing.flow.node_track_title", bodyKey: "landing.flow.node_track_body", numberLabel: "3a.", extraHandles: ["right-target"] },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "3b",
    type: "macondo",
    // software step 2, level with the hardware 3b row
    position: { x: 500, y: 560 },
    data: { fruitSrc: "/images/fruits/guava/icon_interior.webp", titleKey: "landing.flow.node3b_title", bodyKey: "landing.flow.node3b_body", numberLabel: "3b." },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    // software step 3, level with hardware 3c so both columns end together before 4b
    id: "earn",
    type: "macondo",
    position: { x: 500, y: 720 },
    data: { fruitSrc: "/images/fruits/watermelon/icon_interior.webp", titleKey: "landing.flow.node_earn_title", bodyKey: "landing.flow.node_earn_body", numberLabel: "3c.", extraHandles: ["right-source"] },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "4a",
    type: "macondo",
    position: { x: 40, y: 560 },
    data: { fruitSrc: "/images/fruits/coco/icon_interior.webp", titleKey: "landing.flow.node4a_title", bodyKey: "landing.flow.node4a_body", numberLabel: "3b." },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "4b",
    type: "macondo",
    position: { x: 270, y: 960 },
    data: { fruitSrc: "/images/fruits/avocado/icon_interior.webp", titleKey: "landing.flow.node4b_title", bodyKey: "landing.flow.node4b_body", numberLabel: "4." },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
  {
    id: "5",
    type: "macondo",
    position: { x: 40, y: 720 },
    data: { fruitSrc: "/images/fruits/mango/icon.webp", titleKey: "landing.flow.node5_title", bodyKey: "landing.flow.node5_body", numberLabel: "3c.", extraHandles: ["right-source", "left-source"] },
    draggable: false,
    selectable: false,
    width: 220,
    height: 90,
  },
];

// the built-in marker lives in the edge svg, so url(#...) resolves reliably, unlike an external <marker>
const arrowMarker = { type: MarkerType.ArrowClosed, color: "#684D3A", width: 9, height: 9 };

const edges: Edge[] = [
  { id: "1-2", source: "1", target: "2", type: "macondo", markerEnd: arrowMarker },
  { id: "2-3a", source: "2", target: "3a", type: "macondo", markerEnd: arrowMarker },
  { id: "2-track", source: "2", target: "track", type: "macondo", markerEnd: arrowMarker },
  { id: "track-3b", source: "track", target: "3b", type: "macondo", markerEnd: arrowMarker },
  { id: "3a-4a", source: "3a", target: "4a", type: "macondo", markerEnd: arrowMarker },
  { id: "3b-earn", source: "3b", target: "earn", type: "macondo", markerEnd: arrowMarker },
  { id: "4a-5", source: "4a", target: "5", type: "macondo", markerEnd: arrowMarker },
  { id: "5-4b", source: "5", target: "4b", type: "macondo", markerEnd: arrowMarker },
  { id: "earn-4b", source: "earn", target: "4b", type: "macondo", data: { label: "arrow_spend" }, markerEnd: arrowMarker },
  {
    id: "5-3a",
    source: "5",
    target: "3a",
    type: "macondo",
    sourceHandle: "left",
    targetHandle: "left-in",
    data: { label: "arrow_loop", dashed: true },
    markerEnd: arrowMarker,
  },
  {
    id: "earn-track",
    source: "earn",
    target: "track",
    type: "macondo",
    sourceHandle: "right",
    targetHandle: "right-in",
    data: { label: "arrow_loop_software", dashed: true },
    markerEnd: arrowMarker,
  },
];

// markRaw keeps Vue from wrapping the component definitions in reactivity (Vue Flow warns otherwise).
const nodeTypes = {
  macondo: markRaw(MacondoFlowNode),
};
const edgeTypes = {
  macondo: markRaw(MacondoFlowEdge),
};

// vue flow hides nodes until measured, and under <ClientOnly> that can stall,
// so re-measure after mount so edges start from the correct handles
let resizeHandler: (() => void) | null = null;

onMounted(async () => {
  await nextTick();
  updateNodeInternals(nodes.map((n) => n.id));
  // fit after a delay too, or wide viewports stay at zoom=1
  await nextTick();
  setTimeout(() => fitView({ padding: 0.05, duration: 0 }), 50); // short delay so layout has settled
  resizeHandler = () => {
    fitView({ padding: 0.05, duration: 150 });
  };
  window.addEventListener("resize", resizeHandler);
});

onUnmounted(() => {
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
});
</script>

<template>
  <div class="macondo-flow-wrapper relative mx-auto" style="width: 100%; max-width: clamp(760px, 65vw, 1100px); aspect-ratio: 760 / 1100;">
    <!-- the canvas is purely visual, so screen readers get the node sequence as a list -->
    <ol class="sr-only" :aria-label="$t('landing.flow.sr_label')">
      <li v-for="(node, i) in nodes" :key="node.id">
        <strong>{{ node.data.numberLabel }} {{ $t(node.data.titleKey) }}</strong>:
        {{ $t(node.data.bodyKey) }}
        <span v-if="i < nodes.length - 1"> {{ $t('landing.flow.then') }} </span>
      </li>
    </ol>
    <div aria-hidden="true" class="absolute inset-0">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :pan-on-drag="false"
      :pan-on-scroll="false"
      :zoom-on-scroll="false"
      :zoom-on-pinch="false"
      :zoom-on-double-click="false"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :min-zoom="0.5"
      :max-zoom="1.5"
      :fit-view-on-init="true"
      :default-viewport="{ x: 0, y: 20, zoom: 1 }"
      :prevent-scrolling="false"
      class="macondo-flow"
    />

    <!-- circle around node 4b, whose wrapper center is ~(380, 1025) with viewport.y=20 -->
    <svg
      class="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 760 1100"
      preserveAspectRatio="none"
      style="overflow: visible; z-index: 20;"
      aria-hidden="true"
    >
      <path
        d="M 250 1039 C 253 985 310 970 380 970 C 450 970 510 985 510 1039 C 513 1093 450 1108 380 1108 C 310 1108 245 1093 253 1037"
        stroke="#F2BF40"
        stroke-width="11"
        fill="none"
        stroke-linecap="round"
        opacity="0.5"
      />
    </svg>

    <div
      class="absolute font-satoro font-bold text-ds-cream text-sm uppercase tracking-widest text-center bg-ds-brown border-[3px] border-ds-brown shadow-md"
      style="writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 2px; left: -1%; top: 56.8%; transform: translateY(-50%); padding: 16px 5px; z-index: 5;"
    >
      Hardware
    </div>
    <div
      class="absolute font-satoro font-bold text-ds-cream text-sm uppercase tracking-widest text-center bg-ds-brown border-[3px] border-ds-brown shadow-md"
      style="writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 2px; right: -1%; top: 56.8%; transform: translateY(-50%); padding: 16px 5px; z-index: 5;"
    >
      Software
    </div>

    <div
      class="absolute font-satoro font-bold text-ds-brown text-xs sm:text-sm bg-ds-cream px-2 py-0.5 border-2 border-ds-brown shadow-sm whitespace-nowrap"
      style="left: 50%; top: 85%; transform: translate(-50%, -50%) rotate(-4deg); z-index: 10;"
    >
      ↪ {{ $t("landing.flow.arrow_spend") }}
    </div>
    <div
      class="absolute font-satoro font-bold text-ds-brown text-xs sm:text-sm bg-ds-cream px-2 py-0.5 border-2 border-ds-brown shadow-sm whitespace-nowrap"
      style="left: -2%; top: 71%; transform: translate(-50%, -50%) rotate(-7deg); z-index: 10;"
    >
      ↺ {{ $t("landing.flow.arrow_loop") }}
    </div>
    <div
      class="absolute font-satoro font-bold text-ds-brown text-xs sm:text-sm bg-ds-cream px-2 py-0.5 border-2 border-ds-brown shadow-sm whitespace-nowrap"
      style="right: -2%; top: 71%; transform: translate(50%, -50%) rotate(7deg); z-index: 10;"
    >
      ↻ {{ $t("landing.flow.arrow_loop_software") }}
    </div>
    </div>
  </div>
</template>

<style scoped>
.macondo-flow :deep(.vue-flow__background),
.macondo-flow :deep(.vue-flow__minimap),
.macondo-flow :deep(.vue-flow__controls),
.macondo-flow :deep(.vue-flow__attribution) {
  display: none;
}
.macondo-flow :deep(.vue-flow__pane) {
  cursor: default;
}
.macondo-flow :deep(.vue-flow__renderer),
.macondo-flow :deep(.vue-flow__viewport) {
  background: transparent;
}
/* loop edges bow past the svg viewBox, and vue flow clips at several nesting levels */
.macondo-flow,
.macondo-flow :deep(*) {
  overflow: visible !important;
}
.macondo-flow-wrapper {
  overflow: visible;
}
/* Nodes already carry their own border/shadow via Tailwind — strip Vue Flow defaults */
.macondo-flow :deep(.vue-flow__node) {
  box-shadow: none;
}
</style>
