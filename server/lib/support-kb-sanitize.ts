// Kept dependency-free so tests can import it without the DB / Slack graph.
// Untrusted ticket text could fake "=== SECTION ===" scaffolding or [kb:N] citations in the prompt.
export function sanitizeStudentQuestion(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*===.*===\s*$/.test(line))
    .join("\n")
    .replace(/\[kb:\s*\d+\]/gi, "")
    .trim();
}
