<script setup lang="ts">
// Pages hide the navbar via definePageMeta({ layout: "dashboard", hideNavbar: true }).
const route = useRoute();
const hideNavbar = computed(() => route.meta.hideNavbar === true);
</script>

<template>
  <div class="bg-black text-white min-h-screen w-full">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:px-4 focus:py-2 focus:bg-parchment focus:text-ds-brown focus:border-[3px] focus:border-ds-brown focus:font-bold focus:no-underline"
    >
      {{ $t('a11y.skip_to_content') }}
    </a>
    <DashboardNavbar v-if="!hideNavbar" />
    <main id="main-content" tabindex="-1" :class="hideNavbar ? '' : 'pt-16'">
      <slot />
    </main>
    <ClientOnly>
      <HelpWidget />
      <NpsWidget />
      <SubmitDeadlineWidget />
    </ClientOnly>
  </div>
</template>
