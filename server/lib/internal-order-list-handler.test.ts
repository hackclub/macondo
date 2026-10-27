import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(
  import.meta.url,
  new URL("./test-fixtures/internal-order-list-handler.ts", import.meta.url).href,
  "orders endpoint listing paths",
  [
    "full-view path never loads candidates and only loads page buyer state",
    "restricted visibility uses banned only; expensive buyer state is page-scoped",
    "fallback candidates omit joins without search and retain both joins with search",
    "fulfillable-only stays on fallback with reviewer/red/shadow/unproven policy intact",
  ],
);
