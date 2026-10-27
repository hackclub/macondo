<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: string;
  tag?: 'h1' | 'h2' | 'p' | 'span';
  inputType?: 'input' | 'textarea';
  editable?: boolean;
  placeholder?: string;
  maxlength?: number;
}>(), {
  tag: 'span',
  inputType: 'input',
  editable: false,
  placeholder: '',
});

const emit = defineEmits<{
  save: [newValue: string];
}>();

const editing = ref(false);
const draft = ref(props.value);
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

watch(() => props.value, (v) => {
  if (!editing.value) draft.value = v;
});

function startEdit() {
  if (!props.editable) return;
  draft.value = props.value;
  editing.value = true;
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function save() {
  const trimmed = draft.value.trim();
  if (trimmed && trimmed !== props.value) {
    emit('save', trimmed);
  }
  editing.value = false;
}

function cancel() {
  draft.value = props.value;
  editing.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (props.inputType === 'input' && e.key === 'Enter') {
    e.preventDefault();
    save();
  }
  if (props.inputType === 'textarea' && e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    save();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
  }
}
</script>

<template>
  <div class="inline-edit-wrapper group">
    <template v-if="editing">
      <input
        v-if="inputType === 'input'"
        ref="inputRef"
        v-model="draft"
        :placeholder="placeholder"
        :maxlength="maxlength"
        class="w-full ds-input"
        @keydown="onKeydown"
        @blur="save"
      >
      <textarea
        v-else
        ref="inputRef"
        v-model="draft"
        :placeholder="placeholder"
        rows="3"
        class="w-full ds-input resize-none"
        @keydown="onKeydown"
        @blur="save"
      />
    </template>
    <template v-else>
      <component :is="tag" class="inline">{{ value }}</component>
      <button
        v-if="editable"
        class="ml-2 text-ds-brown/40 hover:text-ds-brown opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center"
        title="Edit"
        @click.stop="startEdit"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    </template>
  </div>
</template>

<style scoped>
.inline-edit-wrapper {
  display: flex;
  align-items: center;
}
</style>
