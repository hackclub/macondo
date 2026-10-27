import { eq } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

const SUPPORTED = new Set(["en", "es", "pt"]);

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody<{ locale?: unknown }>(event);
  const locale = typeof body?.locale === "string" ? body.locale : null;
  if (!locale || !SUPPORTED.has(locale)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid locale" });
  }

  await db.update(users).set({ locale }).where(eq(users.id, user.id));
  return { ok: true, locale };
});
