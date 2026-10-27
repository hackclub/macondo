import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(import.meta.url, "./websocket-security.ts", "WebSocket security", [
  "upgrade rejects foreign and missing origins",
  "staff sessions need step-up to subscribe to the internal queue",
  "malformed cookies and oversized messages fail safely",
]);
