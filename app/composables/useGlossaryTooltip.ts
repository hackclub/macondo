import { ref } from "vue";

export function useGlossaryTooltip() {
  const tooltipText = ref("");
  const tooltipVisible = ref(false);
  const tooltipStyle = ref<Record<string, string>>({});

  // Matches the CSS max-width on .glossary-tooltip.
  const TOOLTIP_MAX_WIDTH = 240;
  const VIEWPORT_PAD = 8;

  function onMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList?.contains("glossary-term")) return;
    if (!target.dataset.glossary) return;

    tooltipText.value = target.dataset.glossary;
    tooltipVisible.value = true;

    const rect = target.getBoundingClientRect();
    const flipBelow = rect.top < 60; // approx tooltip height; less room flips it below

    // ::after reads --arrow-offset-x so the arrow stays on the word after clamping.
    const centerX = rect.left + rect.width / 2;
    const tooltipLeft = Math.max(
      VIEWPORT_PAD,
      Math.min(window.innerWidth - TOOLTIP_MAX_WIDTH - VIEWPORT_PAD, centerX - TOOLTIP_MAX_WIDTH / 2),
    );
    const arrowOffsetX = Math.max(
      VIEWPORT_PAD,
      Math.min(TOOLTIP_MAX_WIDTH - VIEWPORT_PAD, centerX - tooltipLeft),
    );

    const baseStyle: Record<string, string> = {
      position: "fixed",
      left: `${tooltipLeft}px`,
      "--arrow-offset-x": `${arrowOffsetX}px`,
    };

    if (flipBelow) {
      tooltipStyle.value = {
        ...baseStyle,
        top: `${rect.bottom + 8}px`,
      };
    } else {
      tooltipStyle.value = {
        ...baseStyle,
        top: `${rect.top - 8}px`,
        transform: "translateY(-100%)",
      };
    }
    tooltipStyle.value["--arrow-direction"] = flipBelow ? "up" : "down";
  }

  function onMouseOut(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList?.contains("glossary-term")) {
      tooltipVisible.value = false;
    }
  }

  return {
    tooltipText,
    tooltipVisible,
    tooltipStyle,
    onMouseOver,
    onMouseOut,
  };
}
