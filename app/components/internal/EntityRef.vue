<script setup lang="ts">
import {
  internalEntityHref,
  internalEntityLabel,
} from "~/utils/internalEntityLinks";

// without a detail route it falls back to plain text, or nothing if hideWhenUnlinkable
const props = defineProps<{
  type: string | null | undefined;
  id: string | number | null | undefined;
  label?: string | null;
  hideWhenUnlinkable?: boolean;
}>();

const href = computed(() => internalEntityHref(props.type, props.id));
const text = computed(
  () => props.label ?? internalEntityLabel(props.type, props.id),
);
</script>

<template>
  <span><NuxtLink
    v-if="href"
    :to="href"
    class="text-amber-300 hover:text-amber-200 hover:underline underline-offset-2 transition-colors"
  >{{ text }}</NuxtLink><template v-else-if="!hideWhenUnlinkable">{{ text }}</template></span>
</template>
