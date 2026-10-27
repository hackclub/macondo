// `guide` grants privileges (hours floor skip), so only these ids may set it.
export const KNOWN_GUIDES = [
  "html",
  "minecraft",
  "usb-hub",
  "devboard",
  "flight-controller",
] as const;

export function isKnownGuide(guide: string | null | undefined): guide is string {
  return typeof guide === "string" && (KNOWN_GUIDES as readonly string[]).includes(guide);
}
