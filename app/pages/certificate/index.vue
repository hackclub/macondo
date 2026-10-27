<script setup lang="ts">
import {
  Award,
  Download,
  FileText,
  Link2,
  ShieldCheck,
  Sparkles,
} from "lucide-vue-next";

definePageMeta({ layout: false });

const { t } = useI18n();
// Public page: guests get no redirect and only see the verify-by-code box.
const { isLoggedIn, loading } = useAuth();

interface CertProgress {
  eligible_hours: number;
  threshold: number;
  remaining: number;
  event_invite_purchased: boolean;
  has_certificate: boolean;
  eligible: boolean;
  code: string | null;
}
const { data: prog, refresh } = useLazyFetch<CertProgress>(
  "/api/profile/certificate",
  {
    key: "certificate-hub",
    default: () => ({
      eligible_hours: 0,
      threshold: 20,
      remaining: 20,
      event_invite_purchased: false,
      has_certificate: false,
      eligible: false,
      code: null,
    }),
  },
);

interface PublicCert {
  code: string;
  recipient_name: string;
  username: string | null;
  hours: number;
  issued_at: string;
  valid: boolean;
  program: string;
}
const claimed = ref<PublicCert | null>(null);

watchEffect(async () => {
  if (prog.value?.has_certificate && prog.value.code && !claimed.value) {
    try {
      claimed.value = await $fetch<PublicCert>(
        `/api/certificates/${prog.value.code}`,
      );
    } catch {
      /* ignore */
    }
  }
});

const recipientName = ref("");
const claiming = ref(false);
const claimError = ref("");
async function claim() {
  claiming.value = true;
  claimError.value = "";
  try {
    claimed.value = (await $fetch<{ ok: boolean; certificate: PublicCert }>(
      "/api/certificates/claim",
      {
        method: "POST",
        body: { recipient_name: recipientName.value.trim() || undefined },
      },
    )).certificate;
    await refresh();
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    claimError.value =
      err?.data?.statusMessage ||
      err?.statusMessage ||
      "Could not claim your certificate.";
  } finally {
    claiming.value = false;
  }
}

const progressPct = computed(() => {
  const c = prog.value;
  return c && c.threshold
    ? Math.min(100, Math.round((c.eligible_hours / c.threshold) * 100))
    : 0;
});
const issuedDate = computed(() =>
  claimed.value
    ? new Date(claimed.value.issued_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "",
);
const imageUrl = computed(() =>
  claimed.value ? `/api/certificates/${claimed.value.code}/image.png` : "",
);
const pdfUrl = computed(() =>
  claimed.value
    ? `/api/certificates/${claimed.value.code}/certificate.pdf`
    : "",
);

// The public certificate page renders the authoritative valid / revoked / not-found status.
const verifyInput = ref("");
const verifyError = ref("");
const verifying = ref(false);
async function verifyCode() {
  const c = verifyInput.value.trim();
  if (!c) {
    verifyError.value = t("certificate.verify.empty_error");
    return;
  }
  verifyError.value = "";
  verifying.value = true;
  try {
    // Tightly rate-limited gate for the typed verify action.
    const res = await $fetch<{ code: string }>("/api/certificates/verify", {
      method: "POST",
      body: { code: c },
    });
    await navigateTo(`/certificate/${encodeURIComponent(res.code)}`);
  } catch (e: unknown) {
    const sc = (e as { statusCode?: number }).statusCode;
    if (sc === 429) verifyError.value = t("certificate.verify.rate_limited");
    else if (sc === 400) verifyError.value = t("certificate.verify.invalid_format");
    else await navigateTo(`/certificate/${encodeURIComponent(c)}`);
  } finally {
    verifying.value = false;
  }
}

useSeoMeta({
  title: "Macondo Certificate",
  description: () => t("certificate.verify.description"),
});
</script>

<template>
  <div class="min-h-screen bg-parchment flex flex-col">
    <header class="w-full">
      <div class="max-w-5xl mx-auto px-5 sm:px-6 py-3 flex items-center justify-center gap-3 sm:gap-4">
        <a
          href="https://hackclub.com"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Hack Club"
          class="shrink-0"
        >
          <img
            src="https://assets.hackclub.com/flag-standalone.svg"
            alt="Hack Club"
            class="h-10 sm:h-12 w-auto drop-shadow"
          >
        </a>
        <span class="text-ds-brown/30 text-3xl font-light select-none" aria-hidden="true">/</span>
        <NuxtLink to="/" aria-label="Macondo" class="shrink-0">
          <img src="/logo_macondo.png" alt="Macondo" class="h-11 sm:h-14 w-auto">
        </NuxtLink>
      </div>
    </header>

    <div class="w-full max-w-2xl mx-auto px-4 pb-12">
      <NuxtLink
        to="/"
        class="ds-btn-ghost inline-flex items-center gap-1.5 text-sm mb-5"
      >
        <Sparkles class="w-4 h-4" /> {{ $t("certificate.index.what_is_macondo") }}
      </NuxtLink>

      <template v-if="isLoggedIn">
        <div
          v-if="loading || (prog.has_certificate && !claimed)"
          class="text-center text-ds-brown/60 py-20"
        >
          {{ $t("certificate.page.loading") }}
        </div>

        <template v-else-if="prog.has_certificate && claimed">
          <CertificateCard
            :name="claimed.recipient_name"
            :hours="claimed.hours"
            :issued-date="issuedDate"
            :code="claimed.code"
            status="valid"
          />
          <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              :href="imageUrl"
              :download="`macondo-certificate-${claimed.code}.png`"
              class="ds-btn-primary inline-flex items-center gap-2"
            >
              <Download class="w-4 h-4" /> {{ $t("certificate.page.download_png") }}
            </a>
            <a
              :href="pdfUrl"
              class="ds-btn-primary-inverted inline-flex items-center gap-2"
            >
              <FileText class="w-4 h-4" /> {{ $t("certificate.page.download_pdf") }}
            </a>
            <NuxtLink
              :to="`/certificate/${claimed.code}`"
              class="ds-btn-ghost inline-flex items-center gap-2"
            >
              <Link2 class="w-4 h-4" /> {{ $t("certificate.index.open_public") }}
            </NuxtLink>
          </div>
        </template>

        <div v-else-if="prog.eligible">
          <div class="p-6 sm:p-10 text-center flex flex-col items-center gap-4">
            <Award class="w-10 h-10 text-ds-success" />
            <h1 class="font-bold text-3xl text-ds-brown">
              {{ $t("certificate.progress.ready_claim") }}
            </h1>
            <p class="text-sm text-ds-brown/70 max-w-md">
              {{ $t("certificate.index.claim_intro") }}
            </p>
            <div class="w-full max-w-sm flex flex-col gap-2 text-left">
              <label class="text-xs font-bold uppercase tracking-wider text-ds-brown/60">
                {{ $t("certificate.index.confirm_name") }}
              </label>
              <input
                v-model="recipientName"
                type="text"
                class="ds-input"
                :placeholder="$t('certificate.index.name_placeholder')"
                maxlength="120"
              >
              <p class="text-xs text-ds-brown/50">{{ $t("certificate.index.name_help") }}</p>
            </div>
            <p v-if="claimError" class="text-sm text-ds-danger">{{ claimError }}</p>
            <button
              type="button"
              class="ds-btn-primary inline-flex items-center gap-2"
              :disabled="claiming"
              @click="claim"
            >
              <Award class="w-4 h-4" />
              {{ claiming ? $t("certificate.index.claiming") : $t("certificate.progress.claim_cta") }}
            </button>
          </div>
        </div>

        <div v-else>
          <div class="p-6 sm:p-10 text-center flex flex-col items-center gap-4">
            <h1 class="font-bold text-3xl text-ds-brown">
              {{ $t("certificate.landing.heading") }}
            </h1>
            <p class="text-sm text-ds-brown/70 max-w-md">
              {{ $t("certificate.index.not_earned_intro") }}
            </p>
            <div class="w-full max-w-sm">
              <div class="w-full h-4 bg-ds-brown/10 border-2 border-ds-brown/20">
                <div
                  class="h-full bg-ds-brown transition-[width] duration-500"
                  :style="{ width: progressPct + '%' }"
                />
              </div>
              <p class="text-xs text-ds-brown/50 mt-1 tabular-nums">
                {{ $t("certificate.progress.hours_of", { current: prog.eligible_hours, total: prog.threshold }) }}
              </p>
            </div>
            <SponsorLogoRow variant="dark" class="my-2" />
            <template v-if="prog.event_invite_purchased">
              <p class="text-sm text-ds-brown/70">{{ $t("certificate.progress.awaiting_attendance") }}</p>
            </template>
            <template v-else>
              <p class="text-sm text-ds-brown/70">{{ $t("certificate.progress.needs_invite") }}</p>
              <NuxtLink to="/shop" class="ds-btn-primary">
                {{ $t("certificate.progress.get_invite_cta") }}
              </NuxtLink>
            </template>
          </div>
        </div>
      </template>

      <section :class="isLoggedIn ? 'mt-10' : ''">
        <div class="flex items-center gap-2 mb-2">
          <ShieldCheck class="w-5 h-5 text-ds-brown" />
          <span class="font-bold text-ds-brown">{{ $t("certificate.verify.heading") }}</span>
        </div>
        <form class="flex items-stretch gap-2" @submit.prevent="verifyCode">
          <input
            v-model="verifyInput"
            type="text"
            class="ds-input flex-1 min-w-0 font-mono tracking-widest uppercase"
            :placeholder="$t('certificate.verify.placeholder')"
            maxlength="20"
          >
          <button
            type="submit"
            class="ds-btn-primary inline-flex items-center gap-1.5 shrink-0"
            :disabled="verifying"
          >
            <ShieldCheck class="w-4 h-4" /> {{ $t("certificate.verify.submit") }}
          </button>
        </form>
        <p v-if="verifyError" class="mt-2 text-sm text-ds-danger">{{ verifyError }}</p>
      </section>
    </div>
  </div>
</template>
