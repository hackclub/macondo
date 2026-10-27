<script setup lang="ts">
// Satori: inline styles and Inter only; images must be same-origin PNG proxy URLs
// because Satori can't embed WebP.
withDefaults(
  defineProps<{
    title?: string;
    owner?: string | null;
    ownerImage?: string;
    hours?: number;
    image?: string;
  }>(),
  {
    title: "Macondo project",
    owner: null,
    ownerImage: undefined,
    hours: 0,
    image: undefined,
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
      padding: 40px;
    "
  >
    <div
      style="
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #f6e5c7;
        border: 12px solid #684d3a;
        padding: 78px 64px 30px 64px;
      "
    >
      <img
        src="/og-logo-macondo.png"
        width="392"
        height="114"
        style="width: 392px; height: 114px; margin-top: -34px; margin-bottom: 8px;"
      >

      <div
        v-if="image"
        style="display: flex; align-items: center; flex: 1;"
      >
        <div
          style="
            display: flex;
            flex-direction: column;
            flex: 1;
            justify-content: center;
            gap: 40px;
            padding-right: 48px;
          "
        >
          <span style="display: flex; font-size: 74px; font-weight: 600; line-height: 1.14; color: #684d3a;">{{ title }}</span>
          <div style="display: flex; align-items: center;">
            <div style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #91a160; border: 4px solid #684d3a; margin-right: 16px; overflow: hidden;">
              <img
                v-if="ownerImage"
                :src="ownerImage"
                width="44"
                height="44"
                style="width: 100%; height: 100%; object-fit: cover;"
              >
              <span
                v-else
                style="display: flex; color: #f6e5c7; font-size: 22px; font-weight: 600;"
              >{{ (owner || "?").charAt(0).toUpperCase() }}</span>
            </div>
            <span style="display: flex; font-size: 30px; font-weight: 500; color: #9a8470;">{{ `by ${owner || "a maker"}${hours && hours > 0 ? ` · ${hours}h` : ""}` }}</span>
          </div>
        </div>
        <div style="display: flex; width: 392px; height: 100%;">
          <img
            :src="image"
            width="392"
            height="392"
            style="width: 392px; height: 100%; object-fit: cover; border: 6px solid #684d3a;"
          >
        </div>
      </div>

      <div
        v-else
        style="display: flex; flex-direction: column; flex: 1; justify-content: flex-start; gap: 44px;"
      >
        <span style="display: flex; font-size: 92px; font-weight: 600; line-height: 1.1; color: #684d3a;">{{ title }}</span>
        <div style="display: flex; align-items: center;">
          <div style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #91a160; border: 4px solid #684d3a; margin-right: 16px; overflow: hidden;">
            <img
              v-if="ownerImage"
              :src="ownerImage"
              width="44"
              height="44"
              style="width: 100%; height: 100%; object-fit: cover;"
            >
            <span
              v-else
              style="display: flex; color: #f6e5c7; font-size: 22px; font-weight: 600;"
            >{{ (owner || "?").charAt(0).toUpperCase() }}</span>
          </div>
          <span style="display: flex; font-size: 30px; font-weight: 500; color: #9a8470;">{{ `by ${owner || "a maker"}${hours && hours > 0 ? ` · ${hours}h` : ""}` }}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; font-size: 26px; font-weight: 600; color: #684d3a;">macondo.hackclub.com</div>
    </div>
  </div>
</template>
