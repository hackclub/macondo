import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(import.meta.url, "./account-ban.ts", "account ban enforcement", [
  "a banned session cannot bypass the UI with direct API requests",
]);
