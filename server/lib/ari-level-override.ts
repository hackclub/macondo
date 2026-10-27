// Kept free of db / Nuxt imports so it's unit-testable under bun test.

/** Canonicalizing ("01" -> "1") means a sloppy field value is never stored verbatim. */
function normalizeLevel(raw: unknown): string | null {
  const s =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "number"
        ? String(raw)
        : null;
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return String(n);
}

/** Null unless the field holds a valid level that differs from the current one. */
export function parseAriLevelOverride(
  currentLevel: string | null,
  rawLevel: unknown,
): { newLevel: string } | null {
  const newLevel = normalizeLevel(rawLevel);
  if (!newLevel) return null;
  if (currentLevel === newLevel) return null;
  return { newLevel };
}
