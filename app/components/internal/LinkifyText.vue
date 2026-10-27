<script setup lang="ts">
import { parseInternalEntityRefs } from "~/utils/internalEntityLinks";

const props = defineProps<{
  text: string | null | undefined;
}>();

const segments = computed(() => parseInternalEntityRefs(props.text));
</script>

<template><template
  v-for="(segment, index) in segments"
  :key="index"
><InternalEntityRef
  v-if="segment.kind === 'ref'"
  :id="segment.id"
  :type="segment.entityType"
  :label="segment.raw"
/><template v-else>{{ segment.value }}</template></template></template>
