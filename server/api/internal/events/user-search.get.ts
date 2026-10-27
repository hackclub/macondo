// lives under events because that role can't reach /api/internal/users; returns no PII

import { and, ilike, or, sql } from "drizzle-orm";

import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { canAccessInternalEvents } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const q = String(getQuery(event).q ?? "").trim();
  if (q.length < 1) return [];
  const like = `%${q}%`;

  return await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      image: users.image,
    })
    .from(users)
    .where(
      and(
        sql`${users.is_temp} IS NOT TRUE`,
        or(
          ilike(users.name, like),
          ilike(users.username, like),
          ilike(users.slack_id, like),
        ),
      ),
    )
    .limit(10);
});
