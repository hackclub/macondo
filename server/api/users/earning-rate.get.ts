import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

import db from "~~/server/db";
import {
  currencyTransactionTable,
  projectTable,
  shipContributorsTable,
  shipTable,
} from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

const APPROVED_SHIP_STATUSES = ["shipped", "shipped_missing_airtable"] as const;

// The realized rate (total reward / approved hours), not the static per-level rate.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  // Override hours win over Hackatime, matching how rewards are computed at approval.
  const [shipAgg] = await db
    .select({
      shipped: sql<number>`COUNT(*)::int`,
      hours: sql<number>`COALESCE(SUM(COALESCE(${shipTable.override_hours}, ${shipTable.hackatime_hours}, 0)), 0)`.mapWith(
        Number,
      ),
    })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.user_id, user.id),
        inArray(shipTable.status, [...APPROVED_SHIP_STATUSES]),
      ),
    );

  // Collaborator gold is already in the numerator, so add their hours; ne() avoids
  // double-counting the owner's own ships.
  const [collabAgg] = await db
    .select({
      shipped: sql<number>`COUNT(*)::int`,
      hours: sql<number>`COALESCE(SUM(COALESCE(${shipContributorsTable.approved_hours}, 0)), 0)`.mapWith(
        Number,
      ),
    })
    .from(shipContributorsTable)
    .innerJoin(shipTable, eq(shipTable.id, shipContributorsTable.ship_id))
    .where(
      and(
        eq(shipContributorsTable.user_id, user.id),
        ne(shipTable.user_id, user.id),
        inArray(shipTable.status, [...APPROVED_SHIP_STATUSES]),
      ),
    );

  const shippedCount =
    Number(shipAgg?.shipped ?? 0) + Number(collabAgg?.shipped ?? 0);
  const totalHours = Number(shipAgg?.hours ?? 0) + Number(collabAgg?.hours ?? 0);

  if (shippedCount === 0 || totalHours <= 0) {
    return {
      has_shipped: shippedCount > 0,
      gold_per_hour: null,
      fruit_per_hour: null,
    };
  }

  // Fruit converts at goldPerFruit per level (app/data/fruitLevels.ts). Joining on ship_id
  // skips the system migration inflows, which would double-count the retired rows.
  const [rewardAgg] = await db
    .select({
      gold: sql<number>`
        COALESCE(SUM(
          CASE
            WHEN ${currencyTransactionTable.fruit_type} IS NULL THEN ${currencyTransactionTable.amount}
            WHEN ${projectTable.level} = '1' THEN ${currencyTransactionTable.amount} * 5
            WHEN ${projectTable.level} = '2' THEN ${currencyTransactionTable.amount} * 15
            WHEN ${projectTable.level} = '3' THEN ${currencyTransactionTable.amount} * 25
            WHEN ${projectTable.level} = '4' THEN ${currencyTransactionTable.amount} * 60
            ELSE 0
          END
        ), 0)
      `.mapWith(Number),
      fruit: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.fruit_type} IS NOT NULL THEN ${currencyTransactionTable.amount} ELSE 0 END), 0)`.mapWith(
        Number,
      ),
    })
    .from(currencyTransactionTable)
    .innerJoin(shipTable, eq(shipTable.id, currencyTransactionTable.ship_id))
    .innerJoin(projectTable, eq(projectTable.id, shipTable.project_id))
    .where(
      and(
        eq(currencyTransactionTable.user_id, user.id),
        eq(currencyTransactionTable.source, "ship_reward"),
        eq(currencyTransactionTable.type, "increase"),
        inArray(shipTable.status, [...APPROVED_SHIP_STATUSES]),
        or(
          eq(currencyTransactionTable.counts, true),
          // Pre-migration fruit rows were retired with counts=false but are still part of the history.
          sql`${currencyTransactionTable.memo} ILIKE ${"%fruit-to-gold migration%"}`,
        ),
      ),
    );

  const totalGold = Number(rewardAgg?.gold ?? 0);
  const totalFruit = Number(rewardAgg?.fruit ?? 0);

  return {
    has_shipped: true,
    // Fruit can be fractional, so it keeps one decimal place.
    gold_per_hour: Math.round(totalGold / totalHours),
    fruit_per_hour:
      totalFruit > 0 ? Math.round((totalFruit / totalHours) * 10) / 10 : null,
    total_gold: totalGold,
    total_hours: totalHours,
  };
});
