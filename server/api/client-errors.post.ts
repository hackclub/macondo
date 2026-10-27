import { getSession } from "~~/server/lib/session";
import { checkRateLimit } from "~~/server/lib/rate-limit";

// Instrumentation: never throws, and is rate-limited (falls open without Redis) so an error loop can't flood the logs.

type ClientErrorBody = {
  source?: unknown;
  message?: unknown;
  stack?: unknown;
  info?: unknown;
  statusCode?: unknown;
  path?: unknown;
};

const clip = (value: unknown, max: number): string => {
  if (value == null) return "";
  return String(value).slice(0, max);
};

export default defineEventHandler(async (event) => {
  // An auth hiccup must never drop the log.
  let viewerId: string | null = null;
  try {
    viewerId = (await getSession(event))?.id ?? null;
  } catch {
    // best-effort
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
  if (!(await checkRateLimit(viewerId ?? ip, "client-error", 10, 60)).allowed) { // 10 reports per minute
    return { ok: false, rateLimited: true };
  }

  const body = await readBody<ClientErrorBody>(event).catch(() => ({}) as ClientErrorBody);

  // Same line shape as error-logging.ts so server and client failures grep alike.
  console.error(
    `[client-error] ${clip(body.source, 40) || "?"} ` +
      `path=${clip(body.path, 200) || "?"} ` +
      `status=${clip(body.statusCode, 8) || "-"} ` +
      `viewer=${viewerId ?? "anon"} ` +
      `ua="${clip(getRequestHeader(event, "user-agent") ?? "?", 200)}"`,
    {
      message: clip(body.message, 1000),
      info: clip(body.info, 300),
      stack: clip(body.stack, 4000),
    },
  );

  return { ok: true };
});
