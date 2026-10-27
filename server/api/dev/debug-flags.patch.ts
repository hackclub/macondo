import { getSession } from "~~/server/lib/session";
import {
  anyDevDebugFlagsEnabled,
  getDevDebugFlags,
  isDevDebugAvailable,
  mergeDevDebugFlags,
  setDevDebugFlags,
} from "~~/server/lib/dev-debug-flags";

export default defineEventHandler(async (event) => {
  if (!isDevDebugAvailable()) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rawBody = await readBody<unknown>(event).catch(() => null);
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};
  const patch =
    body && typeof body.flags === "object" && body.flags !== null
      ? body.flags
      : body;

  const flags = setDevDebugFlags(
    event,
    mergeDevDebugFlags(getDevDebugFlags(event), patch),
  );

  return {
    available: true,
    enabled: anyDevDebugFlagsEnabled(flags),
    flags,
  };
});
