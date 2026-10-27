<script setup lang="ts">
import { ArrowLeft, ExternalLink } from 'lucide-vue-next';

const props = defineProps<{
  id: string;
  url: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}>();

const emit = defineEmits<{
  close: [id: string];
  focus: [id: string];
  'update:position': [id: string, position: { x: number; y: number }];
  'update:size': [id: string, size: { width: number; height: number }];
}>();

function onOpenNewTab() {
  window.open(props.url.replace(/[?&]windowed=1/, '').replace(/\?$/, ''), '_blank');
}

const iframeRef = ref<HTMLIFrameElement | null>(null);

function onIframeLoad() {
  try {
    const doc = iframeRef.value?.contentDocument;
    if (!doc) return;

    doc.addEventListener('click', (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      e.preventDefault();
      e.stopPropagation();
      window.open(href, '_blank');
    }, true);
  } catch {
    // Cross-origin iframe, can't modify
  }
}
</script>

<template>
  <div class="game-modal-overlay" @click.self="emit('close', id)">
    <div class="game-modal">
      <div class="game-modal-bar">
        <button
          class="modal-bar-btn"
          title="Back"
          @click.stop="emit('close', id)"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <button
          class="modal-bar-btn"
          title="Open in new tab"
          @click.stop="onOpenNewTab"
        >
          <ExternalLink class="w-4 h-4" />
        </button>
      </div>

      <iframe
        ref="iframeRef"
        :src="url"
        class="game-modal-content"
        @load="onIframeLoad"
      />
    </div>
  </div>
</template>

<style scoped>
.game-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.game-modal {
  width: 90%;
  max-width: 800px;
  height: 80vh;
  background: #F5E6D3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.game-modal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 2px solid #684D3A;
  background: #F5E6D3;
  flex-shrink: 0;
}

.modal-bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #684D3A;
  transition: opacity 0.2s;
  cursor: pointer;
}

.modal-bar-btn:hover {
  opacity: 0.6;
}

.game-modal-content {
  flex: 1;
  width: 100%;
  border: none;
  background: #F5E6D3;
}
</style>
