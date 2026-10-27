import { gsap } from "gsap";

// Use as <Transition :css="false" @enter @leave> hooks.

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

export function useModalAnimation() {
  function onBackdropEnter(el: Element, done: () => void): void {
    if (prefersReducedMotion()) { done(); return; }
    gsap.fromTo(
      el as HTMLElement,
      { opacity: 0 },
      { opacity: 1, duration: 0.25, ease: "power2.out", onComplete: done },
    );
  }

  function onBackdropLeave(el: Element, done: () => void): void {
    if (prefersReducedMotion()) { done(); return; }
    gsap.to(el as HTMLElement, {
      opacity: 0, duration: 0.2, ease: "power2.in", onComplete: done,
    });
  }

  function onPanelEnter(el: Element, done: () => void): void {
    if (prefersReducedMotion()) { done(); return; }
    gsap.fromTo(
      el as HTMLElement,
      { opacity: 0, scale: 0.92, y: 8 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.32,
        ease: "back.out(1.6)",
        onComplete: done,
      },
    );
  }

  function onPanelLeave(el: Element, done: () => void): void {
    if (prefersReducedMotion()) { done(); return; }
    gsap.to(el as HTMLElement, {
      opacity: 0,
      scale: 0.96,
      y: 4,
      duration: 0.2,
      ease: "power2.in",
      onComplete: done,
    });
  }

  return { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave };
}
