/** Escape a value inside a single-quoted Airtable formula string literal. */
export function escapeAirtableFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
