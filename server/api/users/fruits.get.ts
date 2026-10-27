import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import db from "../../db";
import { currencyTransactionTable } from "../../db/schema";
import { getSession } from "../../lib/session";

// Gold surfaces via /api/users/balance and starfruit via /api/users/starfruit.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rows = await db
    .select({
      fruit: currencyTransactionTable.fruit_type,
      total: sql<number>`COALESCE(SUM(
        CASE WHEN ${currencyTransactionTable.type} = 'increase'
          THEN ${currencyTransactionTable.amount}
          ELSE -${currencyTransactionTable.amount}
        END
      ), 0)`.mapWith(Number),
    })
    .from(currencyTransactionTable)
    .where(
      and(
        eq(currencyTransactionTable.user_id, user.id),
        eq(currencyTransactionTable.counts, true),
        isNotNull(currencyTransactionTable.fruit_type),
        ne(currencyTransactionTable.fruit_type, "starfruit"),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    )
    .groupBy(currencyTransactionTable.fruit_type);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.fruit) counts[row.fruit] = row.total;
  }
  return { counts };
});
