import { macondoHasEnded } from "../../lib/macondo-end";
import { and, gt } from "drizzle-orm";

import db from "../../db";
import { landingPageClicksTable, sessions } from "../../db/schema";
import { sessionTokenCondition } from "../../lib/session";

// Joined to referral_visits on visitor_cookie to measure landing -> guide conversion.

type Body = {
  landing?: unknown;
  target?: unknown;
  locale?: unknown;
};

function trimString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > max) return null;
  return v;
}

export default defineEventHandler(async (event) => {
  if (macondoHasEnded()) {
    setResponseStatus(event, 204);
    return null;
  }

  const body = (await readBody<Body>(event)) ?? {};

  const landing = trimString(body.landing, 64);
  const target = trimString(body.target, 255);

  if (!landing) {
    throw createError({ statusCode: 400, statusMessage: "landing required" });
  }
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: "target required" });
  }

  const sessionToken = getCookie(event, "macondo_session") ?? null;

  let userId: string | null = null;
  if (sessionToken) {
    userId = (
      await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(
          and(
            sessionTokenCondition(sessionToken),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .limit(1)
    )[0]?.userId ?? null;
  }

  await db.insert(landingPageClicksTable).values({
    visitor_cookie: getCookie(event, "macondo_rv") ?? null,
    user_id: userId,
    landing,
    target,
    locale: trimString(body.locale, 8), // max locale length
  });

  return { ok: true };
});
