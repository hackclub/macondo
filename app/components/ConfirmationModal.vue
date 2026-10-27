<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { useEscapeClose } from '~/composables/useEscapeClose';
import { useFocusTrap } from '~/composables/useFocusTrap';
import { useModalAnimation } from '~/composables/useModalAnimation';

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}>(), {
  confirmText: undefined,
  cancelText: undefined,
  variant: 'danger',
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();

const resolvedConfirmText = computed(() => props.confirmText ?? t("common.confirm"));
const resolvedCancelText = computed(() => props.cancelText ?? t("common.cancel"));

const variantClasses: Record<string, string> = {
  danger: 'ds-btn-danger',
  warning: 'ds-btn-warning',
  info: 'ds-btn-primary',
};

const titleId = useId();
const dialogEl = ref<HTMLElement | null>(null);

useEscapeClose(() => props.open, () => emit('cancel'));
useFocusTrap(() => props.open, dialogEl);
</script>

<template>
  <Teleport to="body">
    <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
        @click="emit('cancel')"
      />
    </Transition>
    <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
      <div
        v-if="open"
        ref="dialogEl"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
      >
        <WoodFrame class="w-full max-w-lg mx-4 pointer-events-auto relative">
          <button
            type="button"
            class="absolute top-3 right-3 text-ds-brown/50 hover:text-ds-brown transition-colors z-10"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('cancel')"
          >
            <X :size="20" />
          </button>
          <div class="p-6 flex flex-col gap-4">
            <h2 :id="titleId" class="text-xl font-bold text-ds-brown">{{ title }}</h2>
            <p class="text-sm text-ds-brown/80 leading-relaxed">{{ message }}</p>
            <div class="flex gap-3 justify-end">
              <button
                class="ds-btn-ghost text-sm"
                @click="emit('cancel')"
              >
                {{ resolvedCancelText }}
              </button>
              <button
                class="text-sm"
                :class="variantClasses[variant]"
                @click="emit('confirm')"
              >
                {{ resolvedConfirmText }}
              </button>
            </div>
          </div>
        </WoodFrame>
      </div>
    </Transition>
  </Teleport>
</template>

