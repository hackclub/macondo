// Kept free of Vue/Nuxt so it's unit testable. 0 = full day, 1 = full night.

// Local hours (0..24).
export const DAWN_START = 5;
export const DAWN_END = 7;
export const DUSK_START = 18;
export const DUSK_END = 20;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// `hour` is fractional: minutes live in the decimal part.
export function nightBlendForHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < DAWN_START) return 1;
  if (h < DAWN_END) return 1 - smoothstep((h - DAWN_START) / (DAWN_END - DAWN_START));
  if (h < DUSK_START) return 0;
  if (h < DUSK_END) return smoothstep((h - DUSK_START) / (DUSK_END - DUSK_START));
  return 1;
}

// Falls back to the host's local hour when the zone is missing or invalid.
export function localHourInZone(date: Date, timeZone?: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hh + mm / 60;
  } catch {
    return date.getHours() + date.getMinutes() / 60;
  }
}

export function lerpHex(a: string, b: string, t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)); // offsets of rr, gg, bb after the #
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * x));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
