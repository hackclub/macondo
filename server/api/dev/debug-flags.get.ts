import { getSession } from "~~/server/lib/session";
import {
  anyDevDebugFlagsEnabled,
  getDevDebugFlags,
  isDevDebugAvailable,
} from "~~/server/lib/dev-debug-flags";

export default defineEventHandler(async (event) => {
  if (!isDevDebugAvailable()) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const flags = getDevDebugFlags(event);
  return {
    available: true,
    enabled: anyDevDebugFlagsEnabled(flags),
    flags,
  };
});
