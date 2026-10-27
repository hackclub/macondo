import { isDevDebugAvailable } from "../../lib/dev-debug-flags";
// Dev-only local testing aid; must never be reachable in prod.

import { eq } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { safeReturnTo } from "~~/server/lib/auth";
import { createSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  // Fail closed: only an explicit development build may expose this, so a
  // staging/preview deployment with an unset or non-"production" NODE_ENV can
  // never mint a session for an arbitrary user.
  if (!isDevDebugAvailable()) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const query = getQuery(event);
  const userId = typeof query.userId === "string" ? query.userId : null;
  const email = typeof query.email === "string" ? query.email : null;

  if (!userId && !email) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide ?userId= or ?email=",
    });
  }

  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(userId ? eq(users.id, userId) : eq(users.email, email!))
    .limit(1);

  if (!rows[0]) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  await createSession(event, rows[0].id);

  await sendRedirect(event, safeReturnTo(typeof query.return_to === "string" ? query.return_to : null, "/profile"));
});
