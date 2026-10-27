import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import db from "../../db";
import { currencyTransactionTable } from "../../db/schema";
import { getSession } from "../../lib/session";

// Fruit rows only become gold on conversion. Pending rows are excluded so a source
// that writes pending gold by mistake can't leak into the shop balance.
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
      // Included in `balance` but only spendable on priority-eligible items; lets clients explain a block.
      priority_balance: sql<number>`
        COALESCE(SUM(
          CASE WHEN ${currencyTransactionTable.priority} THEN
            CASE WHEN ${currencyTransactionTable.type} = 'increase'
              THEN ${currencyTransactionTable.amount}
              ELSE -${currencyTransactionTable.amount}
            END
          ELSE 0 END
        ), 0)
      `.mapWith(Number),
    })
    .from(currencyTransactionTable)
    .where(
      and(
        eq(currencyTransactionTable.user_id, user.id),
        eq(currencyTransactionTable.counts, true),
        isNull(currencyTransactionTable.fruit_type),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    );

  return {
    balance: result?.balance ?? 0,
    priority_balance: result?.priority_balance ?? 0,
  };
});
