// deliberately obfuscation, not auth: keeps scrapers off the shop catalog route.
// the route's rate limit is what actually bounds scraping. pure module, no Nitro auto-imports.

import { createHmac, timingSafeEqual } from "node:crypto";

export const UI_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function sign(secret: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(String(expiresAtMs)).digest("hex");
}

export function mintUiToken(secret: string, now: number = Date.now()): string {
  const expiresAtMs = now + UI_TOKEN_TTL_MS;
  return `${expiresAtMs}.${sign(secret, expiresAtMs)}`;
}

export function verifyUiToken(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < now) return false;
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(secret, expiresAtMs), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function secretMatches(
  secret: string,
  candidate: string | null | undefined,
): boolean {
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// the client never derives these, only receives them, so real HMACs are fine here
function bucketValue(secret: string, kind: string, bucket: number): string {
  return createHmac("sha256", secret).update(`${kind}:${bucket}`).digest("hex");
}

export function mintPathToken(secret: string, bucket: number): string {
  return bucketValue(secret, "path", bucket).slice(0, 10); // short url, still 40 bits of search space
}

export function mintObfSecret(secret: string, bucket: number): string {
  return bucketValue(secret, "obf", bucket).slice(0, 32); // 32 hex chars = 128-bit key
}

// accepts `grace` expired buckets so a tab open across a rotation keeps working
export function resolvePathTokenBucket(
  secret: string,
  token: string | null | undefined,
  currentBucket: number,
  grace: number,
): number | null {
  if (!secret || !token) return null;
  const given = Buffer.from(token, "utf8");
  for (let back = 0; back <= grace; back++) {
    const bucket = currentBucket - back;
    const expected = Buffer.from(mintPathToken(secret, bucket), "utf8");
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return bucket;
    }
  }
  return null;
}
