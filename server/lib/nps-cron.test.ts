import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";

await isolatedHandlerTests(
  import.meta.url,
  new URL("./test-fixtures/nps-cron.ts", import.meta.url).href,
  "inline NPS cron",
  [
    "production web schedules startup and recurring sync and cleans up timers",
    "development does not schedule or run sync",
    "slow syncs cannot overlap the next tick",
  ],
);
