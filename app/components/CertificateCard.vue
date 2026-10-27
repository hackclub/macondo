<script setup lang="ts">
import { BadgeCheck, Ban } from "lucide-vue-next";

// PNG/PDF downloads render the same data server-side (server/lib/certificate-image.ts).
// Zero approved hours (staff-issued only) drops the hours clause instead of "0 hours".
defineProps<{
  name: string;
  hours: number;
  issuedDate: string;
  code: string;
  status: "valid" | "revoked";
}>();
</script>

<template>
  <div
    class="relative bg-ds-cream border-[3px] border-ds-brown shadow-xl p-6 sm:p-10 text-center flex flex-col items-center gap-4"
    :class="status === 'revoked' && 'opacity-70'"
  >
    <img
      src="https://assets.hackclub.com/flag-standalone.svg"
      alt="Hack Club"
      class="absolute top-4 left-4 w-16 sm:w-24 h-auto drop-shadow"
    >
    <img src="/logo_macondo.png" alt="Macondo" class="h-16 sm:h-24 w-auto">

    <p
      class="text-xs sm:text-sm tracking-widest font-bold uppercase"
      :class="status === 'valid' ? 'text-ds-success' : 'text-ds-danger'"
    >
      {{ status === 'valid' ? $t('certificate.page.title') : $t('certificate.page.badge_revoked') }}
    </p>

    <p class="text-sm text-ds-brown/70">{{ $t('certificate.page.certifies') }}</p>
    <p class="text-3xl sm:text-4xl font-extrabold text-ds-brown leading-tight">{{ name }}</p>
    <p class="text-sm sm:text-base text-ds-brown/80 max-w-xl">
      {{ hours > 0 ? $t('certificate.page.completed', { hours }) : $t('certificate.page.completed_event') }}
    </p>

    <div class="mt-2 flex flex-col items-center gap-2">
      <p class="text-[11px] tracking-widest font-bold uppercase text-ds-brown/50">
        {{ $t('certificate.landing.recognized_by') }}
      </p>
      <SponsorLogoRow variant="dark" />
    </div>

    <div class="mt-3 w-full pt-4 border-t-2 border-ds-brown/15 flex flex-col items-center gap-2">
      <p class="text-xs text-ds-brown/60">{{ $t('certificate.page.issued', { date: issuedDate }) }}</p>
      <div class="flex items-center gap-2">
        <span class="text-[11px] uppercase tracking-wider text-ds-brown/50">
          {{ $t('certificate.page.code_label') }}
        </span>
        <span class="font-mono tracking-widest text-ds-brown font-bold">{{ code }}</span>
      </div>
      <span
        class="inline-flex items-center gap-1.5 px-3 py-1 border-[3px] text-sm font-bold"
        :class="status === 'valid' ? 'border-ds-success text-ds-success' : 'border-ds-danger text-ds-danger'"
      >
        <component :is="status === 'valid' ? BadgeCheck : Ban" class="w-4 h-4" />
        {{ status === 'valid' ? $t('certificate.page.badge_valid') : $t('certificate.page.badge_revoked') }}
      </span>
    </div>
  </div>
</template>
