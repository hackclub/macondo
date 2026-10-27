<script setup lang="ts">
import { NotebookPen } from "lucide-vue-next";

const props = defineProps<{ projectId: number }>();

// Read-only: projects can no longer be edited, so only an existing note is shown.
const note = ref("");

onMounted(async () => {
  try {
    note.value = (await $fetch<{ note: string }>(
      `/api/projects/${props.projectId}/notes`,
    )).note ?? "";
  } catch {
    // no note or a transient failure: render nothing
  }
});
</script>

<template>
  <div v-if="note.trim()" class="p-4">
    <div class="flex items-center gap-2 mb-1">
      <NotebookPen class="w-5 h-5 text-ds-brown" />
      <h2 class="text-xl font-bold text-ds-brown">{{ $t("project_detail.notes.heading") }}</h2>
    </div>
    <p class="text-sm text-ds-brown/80 whitespace-pre-wrap break-words">{{ note }}</p>
  </div>
</template>
