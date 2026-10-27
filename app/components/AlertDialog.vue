<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-vue-next";
import { useFocusTrap } from "~/composables/useFocusTrap";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

const { state, confirmDialog, dismissAlert } = useAlertDialog();
const route = useRoute();
const isInternal = computed(() => route.path.startsWith("/internal/"));

const titleId = useId();
const promptLabelId = useId();
const dialogEl = ref<HTMLElement | null>(null);
useFocusTrap(() => state.value.visible, dialogEl);

const iconComponent = computed(() => {
  switch (state.value.tone) {
    case "error":
      return X;
    case "success":
      return CheckCircle2;
    case "warning":
      return AlertTriangle;
    default:
      return Info;
  }
});

const iconClass = computed(() => {
  switch (state.value.tone) {
    case "error":
      return "text-ds-danger";
    case "success":
      return "text-ds-success";
    case "warning":
      return "text-tuscan-sun-500";
    default:
      return "text-ds-brown";
  }
});

const internalIconClass = computed(() => {
  switch (state.value.tone) {
    case "error":
      return "text-red-400";
    case "success":
      return "text-emerald-400";
    case "warning":
      return "text-amber-300";
    default:
      return "text-zinc-300";
  }
});

const internalBorderClass = computed(() => {
  if (state.value.destructive || state.value.tone === "error") return "border-red-700";
  if (state.value.tone === "warning") return "border-amber-700";
  if (state.value.tone === "success") return "border-emerald-700";
  return "border-zinc-700";
});

const internalTitleClass = computed(() => {
  if (state.value.destructive || state.value.tone === "error") return "text-red-200";
  if (state.value.tone === "warning") return "text-amber-200";
  if (state.value.tone === "success") return "text-emerald-200";
  return "text-zinc-100";
});

const internalConfirmClass = computed(() =>
  state.value.destructive
    ? "bg-red-700/40 text-red-100 hover:bg-red-700/60 border-red-700"
    : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border-zinc-700",
);

const confirmDisabled = computed(() => {
  if (state.value.mode === "prompt" && state.value.required) {
    return state.value.inputValue.trim().length === 0;
  }
  return false;
});

const promptRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => [state.value.visible, state.value.mode] as const,
  ([visible, mode]) => {
    if (visible && mode === "prompt") {
      nextTick(() => promptRef.value?.focus());
    }
  },
);

function onKeydown(e: KeyboardEvent) {
  if (!state.value.visible) return;
  if (e.key === "Escape") {
    e.preventDefault();
    dismissAlert();
    return;
  }
  if (e.key === "Enter") {
    if (state.value.mode === "prompt") {
      if (document.activeElement === promptRef.value && !(e.ctrlKey || e.metaKey)) {
        return;
      }
    }
    e.preventDefault();
    if (state.value.mode === "alert") {
      confirmDialog();
    } else if (!confirmDisabled.value) {
      confirmDialog();
    }
  }
}

onMounted(() => {
  if (import.meta.client) window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
      <div
        v-if="state.visible"
        ref="dialogEl"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        @click.self="dismissAlert"
      >
        <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
          <div
            v-if="isInternal"
            :class="[
              'modal-fade-panel relative bg-zinc-950 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg pointer-events-auto border',
              internalBorderClass,
            ]"
          >
            <div class="flex items-start gap-3">
              <component :is="iconComponent" :size="28" :class="internalIconClass" class="shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <h2 :id="titleId" :class="['text-lg font-bold', internalTitleClass]">{{ state.title }}</h2>
                <p class="text-sm text-zinc-300 mt-1 whitespace-pre-wrap break-words">
                  {{ state.message }}
                </p>
              </div>
            </div>

            <label v-if="state.mode === 'prompt'" :for="promptLabelId" class="sr-only">{{ state.title }}</label>
            <textarea
              v-if="state.mode === 'prompt'"
              :id="promptLabelId"
              ref="promptRef"
              v-model="state.inputValue"
              :placeholder="state.placeholder"
              rows="3"
              class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
            />

            <div
              class="flex gap-2"
              :class="state.mode === 'alert' ? 'justify-end' : 'justify-between'"
            >
              <button
                v-if="state.mode !== 'alert'"
                class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                @click="dismissAlert"
              >
                {{ state.cancelLabel }}
              </button>
              <button
                :class="['text-sm font-bold px-4 py-2 transition-colors disabled:opacity-50 border', internalConfirmClass]"
                :disabled="confirmDisabled"
                autofocus
                @click="confirmDialog"
              >
                {{ state.confirmLabel }}
              </button>
            </div>
          </div>

          <WoodFrame v-else class="w-full max-w-md pointer-events-auto">
            <div class="pt-6 px-6 pb-0 flex flex-col gap-8">
              <div class="flex items-start gap-3">
                <component :is="iconComponent" :size="28" :class="iconClass" class="shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <h2 :id="titleId" class="text-lg font-bold text-ds-brown">{{ state.title }}</h2>
                  <p class="text-sm text-ds-brown/80 mt-1 whitespace-pre-wrap break-words">
                    {{ state.message }}
                  </p>
                </div>
              </div>

              <label v-if="state.mode === 'prompt'" :for="promptLabelId" class="sr-only">{{ state.title }}</label>
              <textarea
                v-if="state.mode === 'prompt'"
                :id="promptLabelId"
                ref="promptRef"
                v-model="state.inputValue"
                :placeholder="state.placeholder"
                rows="3"
                class="ds-input text-sm w-full"
              />

              <div
                class="flex gap-2"
                :class="state.mode === 'alert' ? 'justify-end' : 'justify-between'"
              >
                <button
                  v-if="state.mode !== 'alert'"
                  class="ds-btn-ghost text-sm"
                  @click="dismissAlert"
                >
                  {{ state.cancelLabel }}
                </button>
                <button
                  class="text-sm"
                  :class="state.destructive ? 'ds-btn-danger' : 'ds-btn-primary'"
                  :disabled="confirmDisabled"
                  autofocus
                  @click="confirmDialog"
                >
                  {{ state.confirmLabel }}
                </button>
              </div>
            </div>
          </WoodFrame>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
