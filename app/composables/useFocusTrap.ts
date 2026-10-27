import type { Ref } from "vue";

// Escape is deliberately not handled: useEscapeClose and AlertDialog already own it.
export function useFocusTrap(
  visible: Ref<boolean> | (() => boolean),
  container: Ref<HTMLElement | null>,
): void {
  function getVisible(): boolean {
    return typeof visible === "function" ? visible() : visible.value;
  }

  let lastFocus: HTMLElement | null = null;

  const focusableSelector =
    'button, [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable(): HTMLElement[] {
    if (!container.value) return [];
    return Array.from(
      container.value.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-hidden") !== "true" &&
        el.offsetParent !== null,
    );
  }

  function onKey(e: KeyboardEvent) {
    if (!getVisible() || e.key !== "Tab") return;
    const els = getFocusable();
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0]!;
    const last = els[els.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (!(active && container.value?.contains(active))) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  watch(
    () => getVisible(),
    (v) => {
      if (!import.meta.client) return;
      if (v) {
        lastFocus = document.activeElement as HTMLElement | null;
        nextTick(() => {
          // Don't steal focus from autofocus or a manual focus call.
          const active = document.activeElement as HTMLElement | null;
          if (active && container.value?.contains(active)) return;
          getFocusable()[0]?.focus();
        });
      } else if (lastFocus) {
        lastFocus.focus();
        lastFocus = null;
      }
    },
  );

  onMounted(() => {
    if (import.meta.client) window.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    if (import.meta.client) window.removeEventListener("keydown", onKey);
  });
}
