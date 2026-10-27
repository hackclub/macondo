// Shared by server and browser, so it must stay plain sync arithmetic (no crypto APIs).
// OBFUSCATION, NOT ENCRYPTION: the key reaches the browser, so never put secrets behind it.

export const OBF_BUCKET_MS = 15 * 60 * 1000; // key rotation period

export const OBF_BUCKET_GRACE = 3; // expired buckets still accepted, an hour in total

export function obfBucket(nowMs: number): number {
  return Math.floor(nowMs / OBF_BUCKET_MS);
}

// cyrb53, non-cryptographic: bit-identical and synchronous in Node and every browser.
export function obfHash(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0); // pack into a 53-bit integer
}

// mulberry32 PRNG keystream
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // scale to [0, 1)
  };
}

function xorInPlace(bytes: Uint8Array, seed: number): Uint8Array {
  const next = mulberry32(seed);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (bytes[i]! ^ (next() * 256)) & 0xff;
  }
  return bytes;
}

const B64_CHUNK = 8192; // keeps spread args under the engine's argument limit

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + B64_CHUNK, bytes.length)),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function seedFor(secret: string, nonce: string): number {
  // mulberry32 seeds from a uint32
  return obfHash(`${nonce}|${secret}`) >>> 0;
}

// Unlisted keys pass through untouched, so a new shop_items column never vanishes from the client.
export const CATALOG_MANGLED_KEYS: readonly string[] = [
  "items",
  "region",
  "user_has_shipped_project",
  "under_renovation",
  "id",
  "slug",
  "name",
  "description",
  "name_translations",
  "description_translations",
  "price_hours",
  "price_fruit_type",
  "price_fruit_amount",
  "price_fruit_level",
  "price_fruit_category",
  "image_url",
  "kind",
  "fulfillment_provider",
  "source",
  "grant_amount_cents",
  "attachment_urls",
  "inventory_mode",
  "stock_remaining",
  "max_per_user",
  "sale_price_hours",
  "available_until",
  "available",
  "coming_soon",
  "requires_shipped_project",
  "pinned",
  "extra_fruity",
  "regional_pricing",
  "modifiers",
  "category",
  "created_at",
  "updated_at",
  "price_gold",
  "regular_price_hours",
  "regular_price_gold",
  "is_on_sale",
  "is_expired",
  "is_sold_out",
  "is_purchasable",
  "available_in_region",
  "resolved_region",
  "user_has_unlocked",
  "user_purchased_count",
  "hit_per_user_cap",
  "blocked_no_shipped_project",
  "is_locked",
  "max_quantity_per_order",
  "starred",
];

export type CatalogKeyMap = {
  toWire: Map<string, string>;
  fromWire: Map<string, string>;
};

// Collisions are resolved by lengthening deterministically, so both sides agree.
export function buildCatalogKeyMap(secret: string): CatalogKeyMap {
  const toWire = new Map<string, string>();
  const fromWire = new Map<string, string>();

  for (const key of CATALOG_MANGLED_KEYS) {
    let wire = "";
    for (let attempt = 0; attempt < 32; attempt++) { // max collision retries
      // "z" prefix: no canonical key starts with z, so no pass-through clash
      wire =
        "z" +
        obfHash(`${secret}|${key}|${attempt}`)
          .toString(36)
          .slice(0, 4 + Math.floor(attempt / 8)); // 4 chars, one more every 8 collisions
      if (!fromWire.has(wire)) break;
    }
    toWire.set(key, wire);
    fromWire.set(wire, key);
  }

  return { toWire, fromWire };
}

function remapKeys(value: unknown, lookup: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => remapKeys(entry, lookup));
  if (value === null || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[lookup.get(key) ?? key] = remapKeys(entry, lookup);
  }
  return out;
}

export function mangleCatalogKeys(secret: string, value: unknown): unknown {
  return remapKeys(value, buildCatalogKeyMap(secret).toWire);
}

export function unmangleCatalogKeys(secret: string, value: unknown): unknown {
  return remapKeys(value, buildCatalogKeyMap(secret).fromWire);
}

export type ObfuscatedEnvelope = { n: string; d: string };

export function isObfuscatedEnvelope(value: unknown): value is ObfuscatedEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ObfuscatedEnvelope).n === "string" &&
    typeof (value as ObfuscatedEnvelope).d === "string"
  );
}

export function encodeCatalogPayload(
  secret: string,
  nonce: string,
  value: unknown,
): ObfuscatedEnvelope {
  const bytes = new TextEncoder().encode(JSON.stringify(mangleCatalogKeys(secret, value)));
  return { n: nonce, d: bytesToBase64(xorInPlace(bytes, seedFor(secret, nonce))) };
}

export function decodeCatalogPayload(
  secret: string,
  envelope: ObfuscatedEnvelope,
): unknown {
  const bytes = xorInPlace(base64ToBytes(envelope.d), seedFor(secret, envelope.n));
  return unmangleCatalogKeys(secret, JSON.parse(new TextDecoder().decode(bytes)));
}
