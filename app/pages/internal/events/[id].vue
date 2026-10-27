<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

definePageMeta({ layout: "internal" });

const route = useRoute();
const eventId = computed(() => Number(route.params.id));
</script>

<template>
  <InternalEventEditor :event-id="eventId" />
</template>
