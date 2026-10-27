// Ticks are fire-and-forget, so a slow one would overlap itself. State is per wrapper:
// use the SAME wrapped function for the startup call and the interval.
export function guarded<A extends unknown[]>(
  label: string,
  fn: (...args: A) => Promise<unknown>,
): (...args: A) => Promise<void> {
  let running = false;
  return async (...args: A) => {
    if (running) {
      console.warn(`[${label}] previous tick still running, skipping this fire`);
      return;
    }
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
    }
  };
}
