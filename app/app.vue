<script setup lang="ts">
  const route = useRoute()
  const isInternal = computed(() => route.path.startsWith('/internal'))
  const showFloatingSwitcher = computed(() => !isInternal.value)

  useSchemaOrg([
    defineWebSite({ name: 'Macondo' }),
  ])

  if (import.meta.server) {
    defineOgImage('Macondo')
  }

  const isProjects = computed(() => /^\/projects(\/|$)/.test(route.path))
  const isGuide = computed(() => /^\/guides(\/|$)/.test(route.path))
  const switcherClass = computed(() => {
    if (isProjects.value) return 'fixed top-4 right-4 z-[150]'
    // Left of the Cuaderno button; hidden on mobile where it would cover the tutorial footer.
    if (isGuide.value) return 'hidden md:block fixed bottom-5 right-[168px] z-[150]'
    return 'fixed bottom-5 left-5 z-[150]'
  })
  const switcherDropUp = computed(() => !isProjects.value)

  // Mounted at the root so audio survives navigation; outside these routes there's no control, so pause.
  const { pause: pauseMusic, enabled: musicFlagEnabled } = useMusicPlayer()
  const musicEnabledRoute = computed(() =>
    /^\/(dashboard|shop|profile|docs)(\/|$)/.test(route.path),
  )
  watch(musicEnabledRoute, (enabled) => {
    if (!enabled) pauseMusic()
  })
</script>

<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <LanguageSwitcher
      v-if="showFloatingSwitcher"
      :class="switcherClass"
      :drop-up="switcherDropUp"
    />
    <ClientOnly>
      <InternalPopUp v-if="!isInternal" />
      <ImpersonationBanner />
      <MusicPlayer v-show="musicEnabledRoute && musicFlagEnabled" />
    </ClientOnly>
    <AlertDialog />
  </div>
</template>
