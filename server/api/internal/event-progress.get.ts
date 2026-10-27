import { buildEventProgress } from "../../lib/event-progress";

// auth is enforced centrally in server/middleware/auth.ts
export default defineEventHandler(async () => {
  return await buildEventProgress();
});
