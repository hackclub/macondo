<script setup lang="ts">
import { Lightbulb, AlertTriangle, Info, OctagonAlert } from "lucide-vue-next";

type CalloutType = "tip" | "warning" | "note" | "danger";

const props = withDefaults(
  defineProps<{
    type?: CalloutType;
    title?: string;
  }>(),
  { type: "note" },
);

const variants: Record<CalloutType, { icon: typeof Lightbulb; border: string; bg: string; fg: string; labelKey: string }> = {
  tip:     { icon: Lightbulb,    border: "#91A160", bg: "rgb(145 161 96 / 0.12)", fg: "#5a6938", labelKey: "docs.callout.tip" },
  warning: { icon: AlertTriangle, border: "#FFB774", bg: "rgb(255 183 116 / 0.18)", fg: "#8a5320", labelKey: "docs.callout.warning" },
  note:    { icon: Info,         border: "#684D3A", bg: "rgb(104 77 58 / 0.08)",  fg: "#684D3A", labelKey: "docs.callout.note" },
  danger:  { icon: OctagonAlert, border: "#892808", bg: "rgb(137 40 8 / 0.10)",   fg: "#892808", labelKey: "docs.callout.danger" },
};

const variant = computed(() => variants[props.type]);
const { t } = useI18n();
const heading = computed(() => props.title ?? t(variant.value.labelKey));
</script>

<template>
  <div
    class="doc-callout not-prose flex gap-3 my-6 p-4 border-l-[5px]"
    :style="{ background: variant.bg, borderLeftColor: variant.border }"
  >
    <component :is="variant.icon" :size="20" :color="variant.fg" class="shrink-0 mt-0.5" />
    <div class="flex-1 min-w-0">
      <div class="font-bold text-sm uppercase tracking-wide mb-1" :style="{ color: variant.fg }">
        {{ heading }}
      </div>
      <div class="text-ds-brown/90 text-sm leading-relaxed doc-callout-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-callout-body :deep(p) {
  margin: 0;
}
.doc-callout-body :deep(p + p) {
  margin-top: 0.5rem;
}
.doc-callout-body :deep(a) {
  color: #684D3A;
  text-decoration: underline;
  font-weight: 600;
}
.doc-callout-body :deep(code) {
  background: rgb(104 77 58 / 0.12);
  padding: 0.1rem 0.3rem;
  font-size: 0.85em;
}
.doc-callout-body :deep(ul),
.doc-callout-body :deep(ol) {
  margin: 0.25rem 0 0;
  padding-left: 1.25rem;
}
</style>
