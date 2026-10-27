import { and, eq, isNotNull, sql } from "drizzle-orm";

import db from "../../db";
import { currencyTransactionTable } from "../../db/schema";
import { getSession } from "../../lib/session";

// Pending rows are filtered for parity with other balances, though starfruit is
// always written unlocked today.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const [result] = await db
    .select({
      balance: sql<number>`
        COALESCE(SUM(
          CASE WHEN ${currencyTransactionTable.type} = 'increase'
            THEN ${currencyTransactionTable.amount}
            ELSE -${currencyTransactionTable.amount}
          END
        ), 0)
      `.mapWith(Number),
      lifetime_earned: sql<number>`
        COALESCE(SUM(
          CASE WHEN ${currencyTransactionTable.type} = 'increase'
            THEN ${currencyTransactionTable.amount}
            ELSE 0
          END
        ), 0)
      `.mapWith(Number),
    })
    .from(currencyTransactionTable)
    .where(
      and(
        eq(currencyTransactionTable.user_id, user.id),
        eq(currencyTransactionTable.counts, true),
        eq(currencyTransactionTable.fruit_type, "starfruit"),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    );

  return {
    balance: result?.balance ?? 0,
    lifetime_earned: result?.lifetime_earned ?? 0,
  };
});
