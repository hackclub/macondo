// Crockford base32 minus confusables; the dash is part of the stored form so the column compares directly.

import { randomBytes } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALPHABET_LOOKUP = new Set(ALPHABET.split(""));

export function generateCrockfordChars(numChars: number): string {
  const bits = numChars * 5;
  const numBytes = Math.ceil(bits / 8);
  const bytes = randomBytes(numBytes);
  let acc = 0n;
  for (let i = 0; i < numBytes; i++) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  // Discard the low padding bits so we consume exactly `bits` from the top.
  acc >>= BigInt(numBytes * 8 - bits);
  let out = "";
  for (let i = numChars - 1; i >= 0; i--) {
    out += ALPHABET[Number((acc >> BigInt(i * 5)) & 0x1fn)];
  }
  return out;
}

export function normalizeCrockfordChars(
  input: string,
  expected: number,
): string | null {
  if (typeof input !== "string") return null;
  const stripped = input
    .toUpperCase()
    .split("")
    .filter((ch) => ALPHABET_LOOKUP.has(ch))
    .join("");
  return stripped.length === expected ? stripped : null;
}
