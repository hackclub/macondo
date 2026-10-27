
import { describe, expect, test } from "bun:test";

import { preferFullerAddressName } from "./shipping-address";

const addr = (first: string, last: string) => ({ first_name: first, last_name: last });

describe("preferFullerAddressName accepts strict expansions", () => {
  test.each([
    ["Yash", "Singh", "Yash Vardhan", "Singh"],
    ["Atharv", "Chavan", "Atharv Vasant", "Chavan"],
    ["Rohan", "Vasa", "Rohan Seshasai", "Vasa"],
    ["Sudhish", "Reddy", "Yeduguri Sudhish", "Reddy"],
    ["Ahmed", "Ashraf", "Ahmed Ashraf", "AboAlGhait"],
    ["Anvar", ".", "Anvar", "Saetov"],
  ])("%s %s -> %s %s", (bf, bl, af, al) => {
    expect(preferFullerAddressName(bf, bl, addr(af, al))).toEqual({
      first: af,
      last: al,
    });
  });

  test("folds diacritics when matching tokens", () => {
    expect(
      preferFullerAddressName("Ana", "Antúnez Martinez", addr("Ana Lucia", "Antunez Martinez")),
    ).toEqual({ first: "Ana Lucia", last: "Antunez Martinez" });
  });

  test("expands a single-letter token into a token starting with it", () => {
    expect(preferFullerAddressName("M", "S", addr("Madhav", "Saravanan"))).toEqual({
      first: "Madhav",
      last: "Saravanan",
    });
    expect(preferFullerAddressName("K", "C", addr("Kameron", "C"))).toEqual({
      first: "Kameron",
      last: "C",
    });
  });
});

describe("preferFullerAddressName rejects anything that is not an expansion", () => {
  // Every pair here is a real prod row where the address holds a parent,
  // guardian, or mail drop rather than the maker.
  test.each([
    ["Phoebe", "Kielbasinski", "Michael", "Kielbasinski"],
    ["Adarsh", "Kushwaha", "Prakash", "Kushwaha"],
    ["Kashaf", "Eman", "Huzaifa Saeed", "Baghoor"],
    ["Boston", "M", "Discard", "Mail"],
    ["Jimi", "J", "Marek", "Leszczyński"],
    ["Vera", "Heltborg", "Wilmer", "Heltborg"],
    ["Rajan", "KC", "Anup", "Sharma"],
    ["DCMitul", ".", "Upendra", "Singh"],
  ])("keeps %s %s over %s %s", (bf, bl, af, al) => {
    expect(preferFullerAddressName(bf, bl, addr(af, al))).toBeNull();
  });

  test("rejects a shorter or equal address name", () => {
    expect(preferFullerAddressName("Kai Ling", "Ma", addr("Kai", "Ling"))).toBeNull();
    expect(preferFullerAddressName("HARISH", "S", addr("HARISH", "S"))).toBeNull();
  });

  test("rejects a name that is one token repeated", () => {
    expect(preferFullerAddressName("Divyansh", "", addr("Divyansh", "Divyansh"))).toBeNull();
  });

  test("rejects junk and missing address names", () => {
    expect(preferFullerAddressName("Emma", "Ng", addr("test", "test"))).toBeNull();
    expect(preferFullerAddressName("Emma", "Ng", addr("", ""))).toBeNull();
    expect(preferFullerAddressName("Emma", "Ng", null)).toBeNull();
  });

  test("rejects when the basic_info name is empty", () => {
    expect(preferFullerAddressName("", "", addr("Ana Lucia", "Martinez"))).toBeNull();
  });
});
