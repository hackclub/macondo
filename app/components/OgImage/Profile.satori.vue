<script setup lang="ts">
// image must be a same-origin PNG proxy URL: Satori can't embed WebP
withDefaults(
  defineProps<{
    username?: string;
    image?: string;
    projectCount?: number;
    topStreakDays?: number;
    totalUpvotes?: number;
  }>(),
  {
    username: "maker",
    image: undefined,
    projectCount: 0,
    topStreakDays: 0,
    totalUpvotes: 0,
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

      <div style="display: flex; align-items: center; flex: 1;">
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 200px;
            height: 200px;
            background: #91a160;
            border: 6px solid #684d3a;
            margin-right: 48px;
            overflow: hidden;
          "
        >
          <img
            v-if="image"
            :src="image"
            width="200"
            height="200"
            style="width: 100%; height: 100%; object-fit: cover;"
          >
          <span
            v-else
            style="display: flex; color: #f6e5c7; font-size: 104px; font-weight: 600;"
          >{{ (username || "?").charAt(0).toUpperCase() }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 26px;">
          <span style="display: flex; font-size: 72px; font-weight: 600; color: #684d3a;">{{ username }}</span>
          <span style="display: flex; font-size: 34px; font-weight: 500; color: #9a8470;">{{ `${projectCount} project${projectCount === 1 ? "" : "s"} · ${topStreakDays}-day streak · ${totalUpvotes} upvote${totalUpvotes === 1 ? "" : "s"}` }}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; font-size: 26px; font-weight: 600; color: #684d3a;">macondo.hackclub.com</div>
    </div>
  </div>
</template>
