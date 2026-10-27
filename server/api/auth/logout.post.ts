import { destroySession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  await destroySession(event);
  return { ok: true };
});
