import { eq } from "drizzle-orm";

import db from "../../../../db";
import { currencyTransactionTable, users } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV !== "development") {
    throw createError({
      statusCode: 403,
      statusMessage: "Only available in development",
    });
  }

  const actor = event.context.user;
  if (!(actor.roles ?? []).includes("supaadmin")) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ amount?: number; memo?: string }>(event);
  const amount = body.amount;
  const memo = body.memo?.trim() || null;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Amount must be a positive whole number",
    });
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const [transaction] = await db
    .insert(currencyTransactionTable)
    .values({
      user_id: id,
      amount,
      type: "increase",
      source: "manual_adjustment",
      memo: memo ? `[DEV] ${memo}` : "[DEV] Manual currency grant",
      created_by_user_id: actor.id,
      counts: true,
    })
    .returning({ id: currencyTransactionTable.id });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "grant_dev_currency",
      entity_type: "user",
      entity_id: id,
      old_value: null,
      new_value: {
        amount,
        type: "increase",
        source: "manual_adjustment",
        memo,
        counts: true,
        transaction_id: transaction?.id ?? null,
      },
      sensitive: true,
      public_message: null,
      change_summary: `Granted ${amount} currency in development`,
    });
  } catch (error) {
    console.error("Failed to write audit log for dev currency grant", error);
  }

  return { ok: true, transactionId: transaction?.id ?? null };
});
