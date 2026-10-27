import { describe, expect, test } from "bun:test";
import { escapeAirtableFormulaString } from "./airtable-formula";

describe("Airtable formula string escaping", () => {
  test("preserves ordinary emails and repository URLs", () => {
    for (const value of ["maker@example.com", "https://github.com/hackclub/lynx", ""]) {
      expect(escapeAirtableFormulaString(value)).toBe(value);
    }
  });

  test("escapes backslashes before quotes, including formula injection payloads", () => {
    const values = ["O'Brien@example.com", "\\", "\\'", "\\\\'", "'), TRUE(), ('", "path\\' OR TRUE()"];
    for (const value of values) {
      const escaped = escapeAirtableFormulaString(value);
      // Parse an escaped single-quoted literal: no unescaped quote may end it early.
      let decoded = "";
      for (let i = 0; i < escaped.length; i++) {
        const char = escaped[i]!;
        if (char === "\\") {
          const next = escaped[++i];
          expect(next === "\\" || next === "'").toBe(true);
          decoded += next;
        } else {
          expect(char).not.toBe("'");
          decoded += char;
        }
      }
      expect(decoded).toBe(value);
    }
  });
});
