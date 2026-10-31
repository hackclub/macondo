<script setup lang="ts">
// This diagram has no interactive controls. Native SVG scales it without a canvas runtime.
const nodes = [
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

const connections = [
  ["1", "2"], ["2", "3a"], ["2", "track"], ["track", "3b"],
  ["3a", "4a"], ["3b", "earn"], ["4a", "5"], ["5", "4b"], ["earn", "4b"],
];
const paths = connections.map(([source, target]) => {
  const from = nodes.find(node => node.id === source)!;
  const to = nodes.find(node => node.id === target)!;
  const x = from.position.x + 110, y = from.position.y + 120;
  const tx = to.position.x + 110, ty = to.position.y;
  const mid = (y + ty) / 2;
  return `M ${x} ${y} C ${x} ${mid} ${tx} ${mid} ${tx} ${ty}`;
});
</script>

<template>
  <div class="macondo-flow-wrapper relative mx-auto w-full max-w-[1100px]">
    <ol class="sr-only" :aria-label="$t('landing.flow.sr_label')">
      <li v-for="node in nodes" :key="node.id">
        <strong>{{ node.data.numberLabel }} {{ $t(node.data.titleKey) }}</strong>:
        {{ $t(node.data.bodyKey) }}
      </li>
    </ol>
    <svg class="w-full h-auto overflow-visible" viewBox="-65 -10 890 1130" aria-hidden="true">
      <defs>
        <marker id="macondo-flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7 Z" fill="#684D3A" />
        </marker>
      </defs>
      <g fill="none" stroke="#684D3A" stroke-width="3.5" marker-end="url(#macondo-flow-arrow)">
        <path v-for="path in paths" :key="path" :d="path" />
        <path d="M40 780 C-100 780 -100 460 40 460" stroke-dasharray="8 7" />
        <path d="M720 780 C860 780 860 460 720 460" stroke-dasharray="8 7" />
      </g>
      <path d="M250 1020 C250 940 510 940 510 1020 C510 1110 250 1110 250 1020" fill="none" stroke="#F2BF40" stroke-width="11" opacity="0.5" />
      <foreignObject v-for="node in nodes" :key="node.id" :x="node.position.x" :y="node.position.y" width="220" height="130">
        <div xmlns="http://www.w3.org/1999/xhtml" class="bg-parchment border-[3px] border-ds-brown p-3 shadow-md min-h-[100px] flex items-start gap-2">
          <img :src="node.data.fruitSrc" class="w-7 h-7 object-contain shrink-0" alt="" loading="lazy">
          <div>
            <p class="font-satoro font-bold text-ds-brown text-sm leading-tight">{{ node.data.numberLabel }} {{ $t(node.data.titleKey) }}</p>
            <p class="text-[11px] text-ds-brown/80 leading-snug mt-0.5">{{ $t(node.data.bodyKey) }}</p>
          </div>
        </div>
      </foreignObject>
      <g fill="#684D3A" text-anchor="middle" class="font-satoro font-bold" font-size="16">
        <text x="150" y="350">Hardware</text>
        <text x="610" y="350">Software</text>
        <text x="380" y="925">↪ {{ $t('landing.flow.arrow_spend') }}</text>
        <text x="150" y="880">↺ {{ $t('landing.flow.arrow_loop') }}</text>
        <text x="610" y="880">↻ {{ $t('landing.flow.arrow_loop_software') }}</text>
      </g>
    </svg>
  </div>
</template>
