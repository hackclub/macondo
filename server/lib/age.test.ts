import { describe, expect, test } from "bun:test";

import {
  ageOutUtcDay,
  computeAgeYears,
  isShipEligibleByAge,
  parseIsoBirthday,
  SHIP_MAX_AGE_EXCLUSIVE,
} from "./age";

const ASOF = new Date("2026-05-04T12:00:00Z");

describe("parseIsoBirthday", () => {
  test("valid YYYY-MM-DD parses to UTC midnight", () => {
    expect(parseIsoBirthday("2007-12-26")?.toISOString()).toBe("2007-12-26T00:00:00.000Z");
  });
  test("null / undefined returns null", () => {
    expect(parseIsoBirthday(null)).toBeNull();
    expect(parseIsoBirthday(undefined)).toBeNull();
    expect(parseIsoBirthday("")).toBeNull();
  });
  test("malformed strings return null", () => {
    expect(parseIsoBirthday("12/26/2007")).toBeNull();
    expect(parseIsoBirthday("2007-13-01")).toBeNull();
    expect(parseIsoBirthday("not a date")).toBeNull();
    expect(parseIsoBirthday("2007-12")).toBeNull();
  });
});

describe("computeAgeYears", () => {
  test("birthday already passed this year", () => {
    expect(computeAgeYears("2007-01-15", ASOF)).toBe(19);
  });
  test("birthday later this year (still last year's age)", () => {
    expect(computeAgeYears("2007-12-26", ASOF)).toBe(18);
  });
  test("birthday today (just turned today)", () => {
    expect(computeAgeYears("2007-05-04", ASOF)).toBe(19);
  });
  test("birthday tomorrow (still 18)", () => {
    expect(computeAgeYears("2007-05-05", ASOF)).toBe(18);
  });
  test("21-year-old (NIYONKURU case)", () => {
    expect(computeAgeYears("2005-02-02", ASOF)).toBe(21);
  });
  test("17-year-old (eligible)", () => {
    expect(computeAgeYears("2009-01-22", ASOF)).toBe(17);
  });
  test("missing birthday returns null", () => {
    expect(computeAgeYears(null, ASOF)).toBeNull();
    expect(computeAgeYears(undefined, ASOF)).toBeNull();
  });
  test("Date input works directly", () => {
    expect(
      computeAgeYears(new Date("2007-05-04T00:00:00Z"), ASOF),
    ).toBe(19);
  });
});

describe("ageOutUtcDay", () => {
  test("19th birthday is the age-out day", () => {
    expect(ageOutUtcDay("2007-06-20")).toBe("2026-06-20");
  });
  test("boundary agrees with computeAgeYears (day before still 18, day itself 19)", () => {
    expect(computeAgeYears("2007-06-20", new Date("2026-06-19T23:00:00Z"))).toBe(18);
    expect(computeAgeYears("2007-06-20", new Date("2026-06-20T01:00:00Z"))).toBe(19);
  });
  test("Feb-29 birthday rolls to Mar-1 in a non-leap year", () => {
    expect(ageOutUtcDay("2008-02-29")).toBe("2027-03-01");
  });
  test("missing / malformed birthday returns null", () => {
    expect(ageOutUtcDay(null)).toBeNull();
    expect(ageOutUtcDay(undefined)).toBeNull();
    expect(ageOutUtcDay("12/26/2007")).toBeNull();
  });
});

describe("isShipEligibleByAge", () => {
  test("constant is 19 (must be < 19)", () => {
    expect(SHIP_MAX_AGE_EXCLUSIVE).toBe(19);
  });
  test("18 is eligible", () => {
    expect(isShipEligibleByAge("2007-12-26", ASOF)).toBe(true);
  });
  test("19 is NOT eligible (boundary)", () => {
    expect(isShipEligibleByAge("2007-05-04", ASOF)).toBe(false);
    expect(isShipEligibleByAge("2007-01-15", ASOF)).toBe(false);
  });
  test("21 is NOT eligible (NIYONKURU)", () => {
    expect(isShipEligibleByAge("2005-02-02", ASOF)).toBe(false);
  });
  test("13 is eligible (lower-bound is HCA's job, not ours)", () => {
    expect(isShipEligibleByAge("2013-01-01", ASOF)).toBe(true);
  });
  test("missing birthday is treated as eligible (HCA gates this upstream)", () => {
    expect(isShipEligibleByAge(null, ASOF)).toBe(true);
    expect(isShipEligibleByAge(undefined, ASOF)).toBe(true);
    expect(isShipEligibleByAge("", ASOF)).toBe(true);
  });
});
