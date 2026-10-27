<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    kind?: "site" | "doc";
  }>(),
  {
    title: "Macondo",
    description: "Make personal projects. Win free prizes.",
    kind: "site",
  },
);
</script>

<template>
  <div
    style="
      width: 100%;
      height: 100%;
      display: flex;
      background: #eacfb3;
      font-family: 'Inter', sans-serif;
      color: #684d3a;
      padding: 40px;
    "
  >
    <div
      style="
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        border: 12px solid #684d3a;
        background: #f6e5c7;
        padding: 56px 64px;
      "
    >
      <div style="display: flex; align-items: center;">
        <img
          v-if="kind === 'doc'"
          src="/logo_macondo.png"
          alt="Macondo"
          width="230"
          height="72"
        >
      </div>

      <div style="display: flex; flex-direction: column; gap: 24px;">
        <span
          v-if="kind === 'doc'"
          style="
            font-size: 22px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 4px;
            color: #91a160;
          "
        >Documentation</span>

        <img
          v-if="kind === 'site'"
          src="/logo_macondo.png"
          alt="Macondo"
          width="640"
          height="200"
        >
        <span
          v-else
          style="
            font-family: 'Are You Serious', cursive;
            font-size: 92px;
            line-height: 1.05;
            color: #684d3a;
          "
        >{{ title }}</span>

        <span
          v-if="description"
          style="
            font-size: 30px;
            line-height: 1.35;
            color: #684d3aaa;
            font-weight: 500;
          "
        >{{ description }}</span>
      </div>

      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 22px;
          color: #684d3a;
          font-weight: 600;
        "
      >
        <span>macondo.hackclub.com</span>
        <span style="color: #684d3a;">Build hardware or software. Get it funded.</span>
      </div>
    </div>
  </div>
</template>
