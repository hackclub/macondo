import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(
  import.meta.url,
  new URL("./test-fixtures/internal-user-list-handler.ts", import.meta.url).href,
  "internal users listing",
  [
    "single ship read, parallel phases, pre-visibility totals and unchanged hydration",
    "PII search/output and impersonation remain role gated",
    "supaadmin sees self, but cannot impersonate self",
    "trust filter retains capped scan, visible total and in-memory pagination",
    "invalid pagination is finite and positive; ordinary pagination and limit cap survive",
    "empty results skip related SQL",
  ],
);
