<script setup lang="ts">
import { MessageSquareHeart, X } from "lucide-vue-next";
import { formatGold } from "~/utils/formatGold";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useGoldBalance } from "~/composables/useGoldBalance";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

type EligibilityResponse = {
  eligible: boolean;
  npsCount?: number;
  shippedCount?: number;
  unlockCondition?: "ship_project" | null;
};

type SubmitResponse = {
  ok: boolean;
  goldAwarded: number;
  newBalance: number;
  unlockCondition?: "ship_project" | null;
};

const { t } = useI18n();
const { setBalance: setSharedGoldBalance } = useGoldBalance();

const open = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const eligibility = ref<EligibilityResponse | null>(null);
const eligibilityLoading = ref(false);

const score = ref<number | null>(null);
const doingWell = ref("");
const canImprove = ref("");
const anythingElse = ref("");

const success = ref<{ goldAwarded: number; newBalance: number } | null>(null);

// npsCount at last open; a higher live npsCount means a new round. A count, not a flag,
// so nothing that changes eligibility has to reset it.
const NPS_DISMISSED_AT_KEY = "nps:dismissedAtNpsCount";
const dismissedAtNpsCount = ref<number | null>(null);
if (import.meta.client) {
  try {
    const raw = localStorage.getItem(NPS_DISMISSED_AT_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) dismissedAtNpsCount.value = parsed;
    }
  } catch {
    // localStorage unavailable (private mode); the ref still pauses jumping this session
  }
}

useEscapeClose(open, () => {
  if (!submitting.value) open.value = false;
});

onMounted(() => {
  void loadEligibility();
});

const shouldJump = computed(() => {
  if (eligibility.value?.eligible !== true) return false;
  if (open.value) return false;
  if (success.value) return false;
  const dismissed = dismissedAtNpsCount.value;
  if (dismissed === null) return true;
  return (eligibility.value?.npsCount ?? 0) > dismissed;
});

async function loadEligibility(): Promise<void> {
  eligibilityLoading.value = true;
  try {
    eligibility.value = await $fetch<EligibilityResponse>(
      "/api/nps/eligibility",
    );
  } catch {
    eligibility.value = null;
  } finally {
    eligibilityLoading.value = false;
  }
}

function resetForm(): void {
  score.value = null;
  doingWell.value = "";
  canImprove.value = "";
  anythingElse.value = "";
  error.value = null;
  success.value = null;
}

async function openWidget(): Promise<void> {
  resetForm();
  open.value = true;
  const currentCount = eligibility.value?.npsCount ?? 0;
  dismissedAtNpsCount.value = currentCount;
  if (import.meta.client) {
    try {
      localStorage.setItem(NPS_DISMISSED_AT_KEY, String(currentCount));
    } catch {
      // marker still lives in the ref for this session
    }
  }
  await loadEligibility();
}

function closeWidget(): void {
  if (submitting.value) return;
  open.value = false;
}

const canSubmit = computed(() => {
  if (submitting.value) return false;
  if (!eligibility.value?.eligible) return false;
  if (score.value == null) return false;
  if (doingWell.value.trim().length < 3) return false; // minimum answer length
  if (canImprove.value.trim().length < 3) return false;
  return true;
});


async function submit(): Promise<void> {
  if (!canSubmit.value || score.value == null) return;
  submitting.value = true;
  error.value = null;
  try {
    const res = await $fetch<SubmitResponse>("/api/nps/submit", {
      method: "POST",
      body: {
        score: score.value,
        doing_well: doingWell.value,
        can_improve: canImprove.value,
        anything_else: anythingElse.value,
      },
    });
    success.value = {
      goldAwarded: res.goldAwarded,
      newBalance: res.newBalance,
    };
    // the endpoint re-read the balance post-insert, so newBalance is authoritative
    setSharedGoldBalance(res.newBalance);
    eligibility.value = {
      eligible: false,
      unlockCondition: "ship_project",
    };
    setTimeout(() => {
      if (success.value) {
        open.value = false;
      }
    }, 3000); // close after showing the thank-you state
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 429) {
      eligibility.value = {
        eligible: false,
        unlockCondition: "ship_project",
      };
      error.value = t("feedback.nps.cooldown_message");
    } else {
      error.value =
        (err as { statusMessage?: string })?.statusMessage ||
        (err as Error)?.message ||
        t("feedback.nps.submit_failed");
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="nps-trigger fixed bottom-6 right-24 md:right-28 z-40 w-12 h-12 md:w-16 md:h-16 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-ds-brown flex items-center justify-center shadow-xl hover:bg-parchment active:scale-95"
      :class="{ 'nps-jumping': shouldJump }"
      :aria-label="$t('feedback.nps.trigger_aria')"
      @click="openWidget"
    >
      <MessageSquareHeart class="w-6 h-6 md:w-8 md:h-8" />
    </button>

    <Teleport to="body">
      <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
        <div
          v-if="open"
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          @click="closeWidget"
        />
      </Transition>
      <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[51] flex items-center justify-center p-2 sm:p-4 pointer-events-none"
      >
        <div class="w-full max-w-lg max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] flex pointer-events-auto">
          <WoodFrame class="w-full flex flex-col min-h-0">
            <div
              class="overflow-y-auto -m-1 p-1"
              :class="success || (eligibility && !eligibility.eligible)
                ? 'px-4 pt-4 pb-4 sm:px-8 sm:pt-6 sm:pb-6'
                : 'px-4 pt-4 pb-5 sm:p-8'"
            >
              <div class="flex items-start justify-between gap-3 mb-3 sm:mb-4">
                <h2 class="text-lg sm:text-xl font-bold text-ds-brown leading-tight">
                  {{ $t("feedback.nps.heading") }}
                </h2>
                <button
                  type="button"
                  class="shrink-0 -mt-1 -mr-1 w-8 h-8 flex items-center justify-center text-ds-brown/60 hover:text-ds-brown hover:bg-ds-brown/10 transition-colors"
                  :aria-label="$t('feedback.nps.close')"
                  @click="closeWidget"
                >
                  <X class="w-5 h-5" />
                </button>
              </div>

              <div v-if="success" class="flex flex-col items-center gap-3 text-center py-2">
                <img
                  src="/images/orpheus/orpheus_thinking_excited.webp"
                  alt=""
                  class="w-20 h-20 sm:w-28 sm:h-28 object-contain drop-shadow-md nps-pop-in"
                >
                <div class="text-xl sm:text-2xl font-bold text-ds-brown">
                  {{ $t("feedback.nps.success_title") }}
                </div>
                <div class="text-sm sm:text-base text-ds-brown/80 max-w-sm">
                  {{ $t("feedback.nps.success_body", { gold: success.goldAwarded }) }}
                </div>
                <div class="inline-flex items-center gap-2 border-[3px] border-ds-brown bg-ds-brown text-parchment px-4 sm:px-5 py-2 text-sm font-bold tabular-nums">
                  <img src="/images/icons/money.webp" class="w-4 h-4 object-contain" alt="">
                  {{ $t("feedback.nps.success_balance", { balance: formatGold(success.newBalance) }) }}
                </div>
              </div>

              <div
                v-else-if="eligibility && !eligibility.eligible"
                class="flex flex-col items-center gap-3 text-center py-1"
              >
                <img
                  src="/images/orpheus/orpheus_solding.webp"
                  alt=""
                  class="w-20 h-20 sm:w-24 sm:h-24 object-contain drop-shadow-md opacity-90"
                >
                <div class="text-base sm:text-lg font-bold text-ds-brown">
                  {{ $t("feedback.nps.ineligible_title") }}
                </div>
                <div class="text-sm text-ds-brown/80 max-w-sm">
                  {{ $t("feedback.nps.ineligible_body") }}
                </div>
                <button class="ds-btn-primary mt-1 w-full sm:w-auto" type="button" @click="closeWidget">
                  {{ $t("feedback.nps.close") }}
                </button>
              </div>

              <form v-else class="space-y-4 sm:space-y-5" @submit.prevent="submit">
                <p class="text-xs sm:text-sm text-ds-brown/80 -mt-1 leading-relaxed">
                  {{ $t("feedback.nps.reward_notice") }}
                </p>

                <div>
                  <div class="text-sm sm:text-base font-semibold text-ds-brown mb-1">
                    {{ $t("feedback.nps.scale_question") }}
                    <span class="text-ds-danger">*</span>
                  </div>
                  <div class="text-xs sm:text-sm text-ds-brown/70 mb-2">
                    {{ $t("feedback.nps.subtitle") }}
                  </div>
                  <div class="grid grid-cols-10 gap-1 sm:gap-1.5">
                    <button
                      v-for="n in 10"
                      :key="n"
                      type="button"
                      class="h-9 sm:h-10 border-[3px] border-ds-brown text-xs sm:text-sm font-bold transition-colors min-w-0"
                      :class="score === n
                        ? 'bg-ds-brown text-parchment'
                        : 'bg-transparent text-ds-brown hover:bg-ds-brown/10'"
                      :aria-pressed="score === n"
                      :aria-label="String(n)"
                      @click="score = n"
                    >
                      {{ n }}
                    </button>
                  </div>
                  <div class="flex justify-between text-[10px] sm:text-xs text-ds-brown/60 mt-1.5 gap-2">
                    <span>{{ $t("feedback.nps.scale_min") }}</span>
                    <span class="text-right">{{ $t("feedback.nps.scale_max") }}</span>
                  </div>
                </div>

                <label class="block">
                  <span class="text-sm sm:text-base font-semibold text-ds-brown">
                    {{ $t("feedback.nps.doing_well_label") }}
                    <span class="text-ds-danger">*</span>
                  </span>
                  <textarea
                    v-model="doingWell"
                    required
                    minlength="3"
                    maxlength="2000"
                    rows="3"
                    class="ds-input w-full mt-1.5 text-sm resize-none"
                  />
                </label>

                <label class="block">
                  <span class="text-sm sm:text-base font-semibold text-ds-brown">
                    {{ $t("feedback.nps.can_improve_label") }}
                    <span class="text-ds-danger">*</span>
                  </span>
                  <textarea
                    v-model="canImprove"
                    required
                    minlength="3"
                    maxlength="2000"
                    rows="3"
                    class="ds-input w-full mt-1.5 text-sm resize-none"
                  />
                </label>

                <label class="block">
                  <span class="text-sm sm:text-base font-semibold text-ds-brown">
                    {{ $t("feedback.nps.anything_else_label") }}
                  </span>
                  <textarea
                    v-model="anythingElse"
                    maxlength="2000"
                    rows="3"
                    class="ds-input w-full mt-1.5 text-sm resize-none"
                  />
                </label>

                <div v-if="error" class="text-sm text-ds-danger">{{ error }}</div>

                <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
                  <button
                    class="ds-btn-primary w-full sm:w-auto"
                    :disabled="!canSubmit"
                    type="submit"
                  >
                    {{ submitting ? $t("feedback.nps.submitting") : $t("feedback.nps.submit") }}
                  </button>
                  <button class="ds-btn-ghost w-full sm:w-auto" type="button" @click="closeWidget">
                    {{ $t("feedback.nps.cancel") }}
                  </button>
                  <span
                    v-if="eligibilityLoading"
                    class="text-xs text-ds-brown/60 sm:ml-auto"
                  >
                    {{ $t("feedback.nps.loading") }}
                  </span>
                </div>
              </form>
            </div>
          </WoodFrame>
        </div>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
@keyframes nps-pop-in {
  0% {
    transform: scale(0.4) rotate(-15deg);
    opacity: 0;
  }
  55% {
    transform: scale(1.12) rotate(6deg);
    opacity: 1;
  }
  75% {
    transform: scale(0.96) rotate(-3deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}

.nps-pop-in {
  animation: nps-pop-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .nps-pop-in {
    animation: none;
  }
}

@keyframes nps-jump {
  0%, 40%, 100% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  50% {
    transform: translateY(-24px);
    animation-timing-function: ease-in;
  }
  60% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  68% {
    transform: translateY(-10px);
    animation-timing-function: ease-in;
  }
  76% {
    transform: translateY(0);
  }
}

.nps-trigger {
  transform-origin: center bottom;
  transition: background-color 0.15s;
}

.nps-jumping {
  animation: nps-jump 1.8s infinite;
}

.nps-trigger:active {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .nps-jumping {
    animation: none;
  }
}
</style>
