import { describe, expect, test } from "bun:test";

import { countryToRegion, isShopRegion } from "./regions";

describe("countryToRegion", () => {
  test("one country from every region", () => {
    expect(countryToRegion("US")).toBe("NA");
    expect(countryToRegion("AR")).toBe("SA");
    expect(countryToRegion("BR")).toBe("BR");
    expect(countryToRegion("DE")).toBe("EU");
    expect(countryToRegion("JP")).toBe("AS");
    expect(countryToRegion("IN")).toBe("IN");
    expect(countryToRegion("AU")).toBe("OC");
    expect(countryToRegion("NG")).toBe("AF");
    expect(countryToRegion("AE")).toBe("ME");
  });

  test("India gets its own region, not Asia", () => {
    expect(countryToRegion("IN")).toBe("IN");
  });

  test("Brazil gets its own region, not South America", () => {
    expect(countryToRegion("BR")).toBe("BR");
  });

  test("Other South American countries still go to SA, not BR", () => {
    expect(countryToRegion("AR")).toBe("SA");
    expect(countryToRegion("CL")).toBe("SA");
    expect(countryToRegion("CO")).toBe("SA");
  });

  test("Turkey goes to Middle East, not Asia", () => {
    expect(countryToRegion("TR")).toBe("ME");
  });

  test("Egypt goes to Middle East, not Africa", () => {
    expect(countryToRegion("EG")).toBe("ME");
  });

  test("Russia goes to Europe, not Asia", () => {
    expect(countryToRegion("RU")).toBe("EU");
  });

  test("Namibia (NA) goes to Africa, not North America", () => {
    expect(countryToRegion("NA")).toBe("AF");
  });

  test("Saudi Arabia (SA) goes to Middle East, not South America", () => {
    expect(countryToRegion("SA")).toBe("ME");
  });

  test("case-insensitive", () => {
    expect(countryToRegion("us")).toBe("NA");
    expect(countryToRegion("  de  ")).toBe("EU");
  });

  test("unknown code falls back to NA", () => {
    expect(countryToRegion("ZZ")).toBe("NA");
    expect(countryToRegion("")).toBe("NA");
    expect(countryToRegion(null)).toBe("NA");
    expect(countryToRegion(undefined)).toBe("NA");
  });
});

describe("isShopRegion", () => {
  test("accepts valid region codes", () => {
    for (const code of ["NA", "SA", "BR", "EU", "AS", "IN", "OC", "AF", "ME"]) {
      expect(isShopRegion(code)).toBe(true);
    }
  });

  test("rejects invalid values", () => {
    expect(isShopRegion("XX")).toBe(false);
    expect(isShopRegion("na")).toBe(false);
    expect(isShopRegion("")).toBe(false);
    expect(isShopRegion(null)).toBe(false);
    expect(isShopRegion(42)).toBe(false);
  });
});
