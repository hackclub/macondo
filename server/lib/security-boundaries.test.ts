import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(import.meta.url, "./security-boundaries.ts", "security boundaries", [
  "session hashes cannot be replayed as cookie tokens",
  "legacy plaintext session tokens are rejected",
  "internal gates cover encoded and case-variant paths",
  "cookie mutations require a trusted browser origin",
  "bearer-only OAuth and signed webhooks remain independent of cookies",
  "MCP is unavailable unless explicitly enabled",
  "developer policy bypasses need an explicit local opt-in",
  "step-up cookies reject wrong users, tampering and expiry",
]);
