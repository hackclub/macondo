import { describe, expect, test } from "bun:test";

import {
  buildCatalogKeyMap,
  CATALOG_MANGLED_KEYS,
  decodeCatalogPayload,
  encodeCatalogPayload,
  isObfuscatedEnvelope,
  mangleCatalogKeys,
  obfBucket,
  obfHash,
  OBF_BUCKET_MS,
  unmangleCatalogKeys,
} from "./shop-obfuscation";

const SECRET = "0123456789abcdef0123456789abcdef";

const catalogFixture = {
  items: [
    {
      id: 42,
      slug: "pi-5",
      name: "Raspberry Pi 5",
      description: "A tiny computer — ünïcodé, emoji 🍇, \"quotes\"",
      price_hours: 12,
      price_gold: 120,
      stock_remaining: null,
      available: true,
      coming_soon: false,
      attachment_urls: ["https://cdn.hackclub.com/a.png"],
      regional_pricing: { IN: { price_hours: 8, available: true } },
      modifiers: [{ label: "Colour", type: "single", options: [{ label: "Red" }] }],
    },
  ],
  region: "NA",
  user_has_shipped_project: true,
  under_renovation: false,
};

describe("round trip", () => {
  test("decode(encode(x)) === x", () => {
    expect(
      decodeCatalogPayload(SECRET, encodeCatalogPayload(SECRET, "nonce-1", catalogFixture)),
    ).toEqual(catalogFixture);
  });

  test("the encoded body is not readable JSON", () => {
    const envelope = encodeCatalogPayload(SECRET, "nonce-1", catalogFixture);
    expect(envelope.d).not.toContain("price_hours");
    expect(envelope.d).not.toContain("Raspberry");
    expect(() => JSON.parse(envelope.d)).toThrow();
    expect(isObfuscatedEnvelope(envelope)).toBe(true);
  });

  test("a different nonce produces a different body for the same input", () => {
    const a = encodeCatalogPayload(SECRET, "nonce-a", catalogFixture);
    const b = encodeCatalogPayload(SECRET, "nonce-b", catalogFixture);
    expect(a.d).not.toBe(b.d);
    expect(decodeCatalogPayload(SECRET, b)).toEqual(catalogFixture);
  });

  test("the wrong secret does not yield the payload", () => {
    const envelope = encodeCatalogPayload(SECRET, "nonce-1", catalogFixture);
    let decoded: unknown = null;
    try {
      decoded = decodeCatalogPayload("a-different-secret-entirely", envelope);
    } catch {
      // garbage bytes failing JSON.parse is a pass
      return;
    }
    expect(decoded).not.toEqual(catalogFixture);
  });

  test("survives a payload larger than one base64 chunk", () => {
    const big = {
      items: Array.from({ length: 400 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: "x".repeat(200),
        price_hours: i,
      })),
    };
    expect(decodeCatalogPayload(SECRET, encodeCatalogPayload(SECRET, "n", big))).toEqual(big);
  });

  test("isObfuscatedEnvelope rejects a plain catalog response", () => {
    expect(isObfuscatedEnvelope(catalogFixture)).toBe(false);
    expect(isObfuscatedEnvelope(null)).toBe(false);
    expect(isObfuscatedEnvelope({ n: 1, d: 2 })).toBe(false);
  });
});

describe("key mangling", () => {
  test("every canonical key gets a distinct wire name", () => {
    const { toWire, fromWire } = buildCatalogKeyMap(SECRET);
    expect(toWire.size).toBe(CATALOG_MANGLED_KEYS.length);
    expect(fromWire.size).toBe(CATALOG_MANGLED_KEYS.length);
    for (const key of CATALOG_MANGLED_KEYS) {
      const wire = toWire.get(key)!;
      expect(wire).toStartWith("z");
      expect(wire).not.toBe(key);
      expect(fromWire.get(wire)).toBe(key);
    }
  });

  test("the map is deterministic per secret and rotates with it", () => {
    expect(buildCatalogKeyMap(SECRET).toWire.get("price_hours")).toBe(
      buildCatalogKeyMap(SECRET).toWire.get("price_hours"),
    );
    expect(buildCatalogKeyMap("other-secret").toWire.get("price_hours")).not.toBe(
      buildCatalogKeyMap(SECRET).toWire.get("price_hours"),
    );
  });

  test("unknown keys pass through untouched in both directions", () => {
    const withNewField = { items: [{ id: 1, brand_new_column: "keep me" }] };
    const mangled = mangleCatalogKeys(SECRET, withNewField) as {
      [k: string]: Array<Record<string, unknown>>;
    };
    const wireItems = buildCatalogKeyMap(SECRET).toWire.get("items")!;
    expect(mangled[wireItems]![0]!.brand_new_column).toBe("keep me");
    expect(unmangleCatalogKeys(SECRET, mangled)).toEqual(withNewField);
  });

  test("nested value keys that are not catalog fields are left alone", () => {
    const mangled = mangleCatalogKeys(SECRET, {
      regional_pricing: { IN: { price_hours: 8 } },
    }) as Record<string, Record<string, unknown>>;
    const wire = buildCatalogKeyMap(SECRET).toWire.get("regional_pricing")!;
    expect(Object.keys(mangled[wire]!)).toEqual(["IN"]);
  });

  test("arrays and primitives round trip unchanged", () => {
    for (const value of [null, 5, "text", true, [1, 2, 3], []]) {
      expect(unmangleCatalogKeys(SECRET, mangleCatalogKeys(SECRET, value))).toEqual(
        value,
      );
    }
  });
});

describe("hashing and buckets", () => {
  test("obfHash is stable and sensitive to input", () => {
    expect(obfHash("abc")).toBe(obfHash("abc"));
    expect(obfHash("abc")).not.toBe(obfHash("abd"));
    expect(Number.isSafeInteger(obfHash("abc"))).toBe(true);
  });

  test("obfBucket advances once per window", () => {
    const base = 1_800_000_000_000;
    const bucket = obfBucket(base);
    expect(obfBucket(base + OBF_BUCKET_MS - 1)).toBe(bucket);
    expect(obfBucket(base + OBF_BUCKET_MS)).toBe(bucket + 1);
  });
});
