import { eq } from "drizzle-orm";

import db from "../../db";
import { users } from "../../db/schema";
import { getSession } from "../../lib/session";

// The ledger is gold-only now; this counter is the surviving record of fruit earned.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const [row] = await db
    .select({ lifetime_fruits_earned: users.lifetime_fruits_earned })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const raw: Record<string, unknown> = row?.lifetime_fruits_earned ?? {};
  const totals: Record<string, number> = {};
  let total = 0;
  for (const [fruit, value] of Object.entries(raw)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      totals[fruit] = n;
      total += n;
    }
  }

  return { totals, total };
});
