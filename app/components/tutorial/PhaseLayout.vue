<script setup lang="ts">
// Tabs on mobile instead of the 50/50 split, which would leave ~207px panes
defineProps<{
  leftLabel: string;
}>();

const activeTab = ref<"left" | "right">("left");
</script>

<template>
  <div class="flex flex-col md:flex-row w-full h-full min-h-0">
    <div
      class="flex md:hidden border-b border-ds-brown/10 bg-parchment shrink-0"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'left'"
        class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
        :class="activeTab === 'left'
          ? 'text-ds-brown border-b-2 border-ds-brown'
          : 'text-ds-brown/40 hover:text-ds-brown/70'"
        @click="activeTab = 'left'"
      >
        {{ leftLabel }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'right'"
        class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors"
        :class="activeTab === 'right'
          ? 'text-ds-brown border-b-2 border-ds-brown'
          : 'text-ds-brown/40 hover:text-ds-brown/70'"
        @click="activeTab = 'right'"
      >
        {{ $t("tutorial_ui.tab_preview") }}
      </button>
    </div>

    <div
      class="min-h-0 min-w-0 md:w-1/2 md:h-full md:border-r md:border-ds-brown/10 md:flex md:flex-col"
      :class="activeTab === 'left' ? 'flex-1 flex flex-col' : 'hidden'"
    >
      <slot name="left" />
    </div>

    <div
      class="min-h-0 min-w-0 md:w-1/2 md:h-full md:block"
      :class="activeTab === 'right' ? 'flex-1' : 'hidden'"
    >
      <slot name="right" />
    </div>
  </div>
</template>
