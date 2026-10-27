// One-word vectors sit near everything, so below the floor Capybara neither indexes nor replies.
// Dependency-free so `bun test` can exercise it.

// "bump", "any update?", "thanks!" fall under it; "my gold is missing" clears it
export const MIN_SUBSTANCE_WORDS = 4;

// distinct, not total: a Slack ticket's subject repeats its body's first line
export function countSubstanceWords(text: string): number {
  const cleaned = (text ?? "")
    // Slack markup: <@U123>, <#C123|name>, <https://…|label>.
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase();
  const words = new Set<string>();
  for (const token of cleaned.split(" ")) {
    if (token.length >= 2) words.add(token);
  }
  return words.size;
}

export function hasEnoughSubstance(text: string): boolean {
  return countSubstanceWords(text) >= MIN_SUBSTANCE_WORDS;
}
