<script setup lang="ts">
type Attachment = {
  url: string;
  filename: string;
  size_bytes?: number;
  mime_type?: string;
  sha?: string;
};

const props = defineProps<{ modelValue: Attachment[] }>();
const emit = defineEmits<{ "update:modelValue": [Attachment[]] }>();

const uploading = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function uploadOne(file: File): Promise<Attachment | null> {
  const form = new FormData();
  form.append("file", file);
  try {
    return await $fetch<Attachment>("/api/support/uploads", {
      method: "POST",
      body: form,
    });
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      "upload failed";
    return null;
  }
}

async function onPick(): Promise<void> {
  const input = fileInput.value;
  if (!input?.files || input.files.length === 0) return;
  uploading.value = true;
  error.value = null;
  const next: Attachment[] = [...props.modelValue];
  for (const f of Array.from(input.files)) {
    const a = await uploadOne(f);
    if (a) next.push(a);
  }
  emit("update:modelValue", next);
  input.value = "";
  uploading.value = false;
}

function remove(i: number): void {
  const next = [...props.modelValue];
  next.splice(i, 1);
  emit("update:modelValue", next);
}

function humanSize(b?: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div>
    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      @change="onPick"
    >
    <button
      type="button"
      class="ds-btn-ghost text-xs"
      :disabled="uploading"
      @click="fileInput?.click()"
    >
      {{ uploading ? "Uploading..." : "+ attach file" }}
    </button>
    <div v-if="error" class="text-xs text-ds-danger mt-1">{{ error }}</div>
    <ul v-if="modelValue.length > 0" class="mt-2 space-y-1">
      <li
        v-for="(a, i) in modelValue"
        :key="a.url"
        class="flex items-center gap-2 text-xs text-ds-brown bg-white/40 px-2 py-1 border border-ds-brown/20"
      >
        <a :href="a.url" target="_blank" class="underline truncate flex-1">{{ a.filename }}</a>
        <span class="text-ds-brown/60">{{ humanSize(a.size_bytes) }}</span>
        <button type="button" class="text-ds-danger hover:underline" @click="remove(i)">remove</button>
      </li>
    </ul>
  </div>
</template>
