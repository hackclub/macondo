<script setup lang="ts">
import { BadgeCheck, Ban, Check, Download, FileText, Link2, SearchX, ShieldCheck } from "lucide-vue-next";

definePageMeta({ layout: false });

const { t } = useI18n();
const route = useRoute();
const code = computed(() => String(route.params.code ?? ""));

interface PublicCert {
  code: string;
  recipient_name: string;
  username: string | null;
  hours: number;
  issued_at: string;
  valid: boolean;
  program: string;
}

const cert = ref<PublicCert | null>(null);
const status = ref<"loading" | "found" | "not_found">("loading");

async function load() {
  status.value = "loading";
  try {
    cert.value = await $fetch<PublicCert>(
      `/api/certificates/${encodeURIComponent(code.value)}`,
    );
    status.value = "found";
  } catch {
    cert.value = null;
    status.value = "not_found";
  }
}
// A watch, not onMounted: verifying another code reuses this same page component.
watch(
  code,
  () => {
    if (!import.meta.client) return;
    void load();
    window.scrollTo({ top: 0, behavior: "smooth" });
  },
  { immediate: true },
);

const issuedDate = computed(() =>
  cert.value
    ? new Date(cert.value.issued_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "",
);
const imageUrl = computed(
  () => `/api/certificates/${encodeURIComponent(code.value)}/image.png`,
);
const pdfUrl = computed(
  () => `/api/certificates/${encodeURIComponent(code.value)}/certificate.pdf`,
);
// Inline PDF so the browser's own viewer shows it as a genuine document.
const inlinePdfUrl = computed(() => `${pdfUrl.value}?inline=1`);

const copyState = ref<"idle" | "copied">("idle");
async function copyLink() {
  if (!import.meta.client) return;
  try {
    await navigator.clipboard.writeText(
      `${window.location.origin}/certificate/${code.value}`,
    );
    copyState.value = "copied";
    setTimeout(() => (copyState.value = "idle"), 1500);
  } catch {
    /* clipboard unavailable; ignore */
  }
}

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

function scrollToVerify() {
  if (!import.meta.client) return;
  document.getElementById("verify")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const input = document.getElementById("verify-code-input") as HTMLInputElement | null;
  setTimeout(() => input?.focus(), 350);
}

// useRequestURL must be read in setup, not inside the computed; the client uses a relative path.
const pageOrigin = import.meta.server ? useRequestURL().origin : "";
const ogImage = computed(() => {
  const path = `/api/certificates/${encodeURIComponent(code.value)}/image.png`;
  return pageOrigin ? `${pageOrigin}${path}` : path;
});
useSeoMeta({
  title: () => `Macondo Certificate — ${code.value}`,
  description: () =>
    "Verify a Macondo Certificate of Completion, recognized by MIT School of Engineering, GitHub, AMD, the Congressional App Challenge, and Girls Who Code.",
  ogImage,
  twitterCard: "summary_large_image",
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

    <main class="flex-1 py-8 sm:py-12 px-4 flex flex-col items-center">
      <div class="w-full max-w-5xl">
        <section id="verify" class="mb-8 scroll-mt-24">
          <div class="flex items-center gap-2 mb-2">
            <ShieldCheck class="w-5 h-5 text-ds-brown" />
            <span class="font-bold text-ds-brown">{{ $t("certificate.verify.heading") }}</span>
          </div>
          <form class="flex items-stretch gap-2" @submit.prevent="verifyCode">
            <input
              id="verify-code-input"
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

        <div v-if="status === 'loading'" class="text-center text-ds-brown/60 py-24">
          {{ $t("certificate.page.loading") }}
        </div>

        <template v-else-if="status === 'found' && cert">
          <div
            class="border-[3px] flex items-center gap-3 px-5 py-4 mb-6"
            :class="cert.valid ? 'border-ds-success bg-ds-success/10' : 'border-ds-danger bg-ds-danger/10'"
          >
            <component
              :is="cert.valid ? BadgeCheck : Ban"
              class="w-8 h-8 shrink-0"
              :class="cert.valid ? 'text-ds-success' : 'text-ds-danger'"
            />
            <div class="text-left">
              <p class="font-bold text-ds-brown text-lg leading-tight">
                {{ cert.valid ? $t("certificate.page.verified_title") : $t("certificate.page.revoked_title") }}
              </p>
              <p class="text-sm text-ds-brown/70">
                {{ cert.valid ? $t("certificate.page.verified_desc") : $t("certificate.page.revoked_note") }}
              </p>
            </div>
          </div>

          <div class="border-[3px] border-ds-brown shadow-xl overflow-hidden bg-zinc-700">
            <iframe
              :src="inlinePdfUrl"
              :title="`Macondo certificate ${cert.code}`"
              class="w-full h-[70vh] min-h-[440px] max-h-[820px] block"
            />
          </div>

          <dl class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="flex flex-col gap-1">
              <dt class="text-[11px] uppercase tracking-wider font-bold text-ds-brown/50">
                {{ $t("certificate.page.recipient_label") }}
              </dt>
              <dd class="text-sm font-semibold text-ds-brown break-words">{{ cert.recipient_name }}</dd>
            </div>
            <!-- Hidden on a zero-hour staff issue, matching the card copy. -->
            <div v-if="cert.hours > 0" class="flex flex-col gap-1">
              <dt class="text-[11px] uppercase tracking-wider font-bold text-ds-brown/50">
                {{ $t("certificate.page.hours_label") }}
              </dt>
              <dd class="text-sm font-semibold text-ds-brown">{{ cert.hours }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-[11px] uppercase tracking-wider font-bold text-ds-brown/50">
                {{ $t("certificate.page.issued_label") }}
              </dt>
              <dd class="text-sm font-semibold text-ds-brown">{{ issuedDate }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-[11px] uppercase tracking-wider font-bold text-ds-brown/50">
                {{ $t("certificate.page.code_label") }}
              </dt>
              <dd class="text-sm font-mono font-bold text-ds-brown tracking-wider break-all">{{ cert.code }}</dd>
            </div>
          </dl>

          <div
            v-if="cert.valid"
            class="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <a
              :href="imageUrl"
              :download="`macondo-certificate-${cert.code}.png`"
              class="ds-btn-primary inline-flex items-center gap-2"
            >
              <Download class="w-4 h-4" /> {{ $t("certificate.page.download_png") }}
            </a>
            <a :href="pdfUrl" class="ds-btn-primary-inverted inline-flex items-center gap-2">
              <FileText class="w-4 h-4" /> {{ $t("certificate.page.download_pdf") }}
            </a>
            <button type="button" class="ds-btn-ghost inline-flex items-center gap-2" @click="copyLink">
              <component :is="copyState === 'copied' ? Check : Link2" class="w-4 h-4" />
              {{ copyState === "copied" ? $t("certificate.page.copied") : $t("certificate.page.copy_link") }}
            </button>
          </div>
        </template>

        <div v-else class="flex justify-center pt-4 pb-2">
          <div class="max-w-md">
            <div class="px-6 py-8 flex flex-col items-center gap-3 text-center">
              <SearchX class="w-10 h-10 text-ds-brown/50" />
              <h1 class="font-bold text-2xl text-ds-brown">
                {{ $t("certificate.page.not_found_title") }}
              </h1>
              <p class="text-sm text-ds-brown/70 max-w-sm">
                {{ $t("certificate.page.not_found_body") }}
              </p>
              <div class="flex gap-3 mt-2">
                <button
                  type="button"
                  class="ds-btn-primary text-sm inline-flex items-center gap-1.5"
                  @click="scrollToVerify"
                >
                  <ShieldCheck class="w-4 h-4" /> {{ $t("certificate.verify.submit") }}
                </button>
                <NuxtLink to="/" class="ds-btn-ghost text-sm">
                  {{ $t("certificate.page.back_home") }}
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
