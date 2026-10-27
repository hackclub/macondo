import { describe, expect, test } from "bun:test";

import { countSubstanceWords, hasEnoughSubstance } from "./support-ticket-substance";

describe("substance gate", () => {
  test("rejects the chatter that files empty tickets", () => {
    // a Slack ticket's subject is its body's first line, so the real caller sees each case doubled
    for (const noise of ["bump", "any update?", "hello there", "thanks!", ""]) {
      expect(hasEnoughSubstance(`${noise}\n\n${noise}`)).toBe(false);
    }
  });

  test("rejects a bare mention or a naked link", () => {
    expect(hasEnoughSubstance("<@U091ZF0JNBG> <@U12345>")).toBe(false);
    expect(hasEnoughSubstance("https://macondo.hackclub.com/projects/15769")).toBe(false);
    expect(hasEnoughSubstance(":wave: :capybara: :blobhaj_party:")).toBe(false);
  });

  test("accepts the shortest real questions", () => {
    expect(hasEnoughSubstance("streak not counting today")).toBe(true);
    expect(hasEnoughSubstance("my gold is missing")).toBe(true);
    expect(
      hasEnoughSubstance("ship rejected\n\nship rejected, why? see https://x.test/a"),
    ).toBe(true);
  });

  test("counts distinct words, so repetition cannot pad a bump", () => {
    expect(countSubstanceWords("bump bump bump bump bump")).toBe(1);
    expect(hasEnoughSubstance("bump bump bump bump bump")).toBe(false);
  });
});
