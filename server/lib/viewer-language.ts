export function resolveViewerLang(raw: string | null | undefined): "en" | "es" {
  return raw?.split("-")[0]?.split("_")[0]?.toLowerCase() === "es" ? "es" : "en";
}
