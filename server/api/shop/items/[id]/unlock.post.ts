import { and, eq, isNotNull, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  shopItemTable,
  shopItemUnlockTable,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { assertFirstPartyRequest } from "../../../../lib/first-party";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { getSession } from "../../../../lib/session";

// A repeat unlock returns 409 instead of double-charging.
export default defineEventHandler(async (event) => {
  assertFirstPartyRequest(event);

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rate = await checkRateLimit(user.id, "shop-unlock:user", 10, 60); // 10 unlocks per minute
  if (!rate.allowed) {
    setResponseHeader(event, "Retry-After", rate.retryAfterSeconds);
    throw createError({
      statusCode: 429,
      statusMessage: `Too many unlock attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
    });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item id" });
  }

  const [item] = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.id, id))
    .limit(1);

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  if (item.extra_fruity !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: "This item is not starfruit-gated",
    });
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${user.id})::bigint)`,
    );

    const [existing] = await tx
      .select({ id: shopItemUnlockTable.id })
      .from(shopItemUnlockTable)
      .where(
        and(
          eq(shopItemUnlockTable.user_id, user.id),
          eq(shopItemUnlockTable.item_id, id),
        ),
      )
      .limit(1);

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: "Item is already unlocked",
      });
    }

    const [balanceRow] = await tx
      .select({
        balance: sql<number>`
          COALESCE(SUM(
            CASE WHEN ${currencyTransactionTable.type} = 'increase'
              THEN ${currencyTransactionTable.amount}
              ELSE -${currencyTransactionTable.amount}
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

    if ((balanceRow?.balance ?? 0) < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "You need at least 1 starfruit to unlock this item",
      });
    }

    const [spendRow] = await tx
      .insert(currencyTransactionTable)
      .values({
        user_id: user.id,
        amount: 1,
        type: "decrease",
        source: "shop_unlock",
        fruit_type: "starfruit",
        memo: `Unlocked shop item #${id} (${item.name})`,
        counts: true,
      })
      .returning({ id: currencyTransactionTable.id });

    const [unlockRow] = await tx
      .insert(shopItemUnlockTable)
      .values({
        user_id: user.id,
        item_id: id,
        currency_transaction_id: spendRow?.id ?? null,
      })
      .returning();

    return { unlockRow };
  });

  try {
    await writeAudit({
      actor_id: user.id,
      action: "unlock_shop_item",
      entity_type: "shop_item",
      entity_id: String(id),
      old_value: null,
      new_value: { item_id: id, unlocked_at: result.unlockRow?.unlocked_at },
      sensitive: false,
      public_message: `Starfruit unlock: ${item.name}`,
      change_summary: item.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop item unlock", error);
  }

  return {
    ok: true,
    item_id: id,
    unlocked_at: result.unlockRow?.unlocked_at ?? null,
  };
});
