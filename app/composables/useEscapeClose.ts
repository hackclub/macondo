import type { Ref } from "vue";

// On window so it still fires when focus is outside the modal subtree.
// AlertDialog has its own keydown handler (it also handles Enter), so it doesn't use this.
export function useEscapeClose(visible: Ref<boolean> | (() => boolean), onClose: () => void): void {
  function getVisible(): boolean {
    return typeof visible === "function" ? visible() : visible.value;
  }

  function handler(e: KeyboardEvent) {
    if (!getVisible()) return;
    if (e.key !== "Escape") return;
    e.preventDefault();
    onClose();
  }

  onMounted(() => {
    if (import.meta.client) window.addEventListener("keydown", handler);
  });
  onBeforeUnmount(() => {
    if (import.meta.client) window.removeEventListener("keydown", handler);
  });
}
