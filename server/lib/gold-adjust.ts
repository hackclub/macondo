// Shared by the internal finance endpoint and the MCP `adjust_user_gold` tool.
// Caller must do the supaadmin authorization check first.
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { createError } from "h3";

import db from "../db";
import { currencyTransactionTable, users } from "../db/schema";
import { writeAudit } from "./audit";
import { notify } from "./notify";

export type GoldAdjustReason =
  | "show_and_tell_won"
  | "show_and_tell_participated";

export interface AdjustUserGoldInput {
  targetUserId: string;
  amount: number;
  direction: "add" | "subtract";
  note: string;
  actorId: string;
  reason?: GoldAdjustReason;
  // Marks the audit row's provenance ("internal" web UI vs "mcp" tool).
  via?: string;
}

export interface AdjustUserGoldResult {
  transactionId: number | null;
  goldBefore: number;
  goldAfter: number;
}

// Throws createError so HTTP callers get the status and MCP relays the message to the model.
export async function adjustUserGold(
  input: AdjustUserGoldInput,
): Promise<AdjustUserGoldResult> {
  const { targetUserId, actorId, via } = input;
  const amount = input.amount;
  const direction = input.direction;
  const note = input.note?.trim();
  const reason = input.reason;

  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Amount must be a positive whole number",
    });
  }
  if (direction !== "add" && direction !== "subtract") {
    throw createError({
      statusCode: 400,
      statusMessage: "Direction must be 'add' or 'subtract'",
    });
  }
  if (!note) {
    throw createError({
      statusCode: 400,
      statusMessage: "A note is required for the audit trail",
    });
  }
  if (
    reason !== undefined &&
    reason !== "show_and_tell_won" &&
    reason !== "show_and_tell_participated"
  ) {
    throw createError({ statusCode: 400, statusMessage: "Invalid reason" });
  }
  if (reason !== undefined && direction !== "add") {
    throw createError({
      statusCode: 400,
      statusMessage: "Show and Tell awards must add gold",
    });
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  // Same per-user lock as shop purchases, so a concurrent spend can't drive the balance negative.
  const { currentGold, transaction } = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${targetUserId})::bigint)`,
    );

    // Mirrors users/[id].get.ts; spend logic assumes this is never negative.
    const [balanceRow] = await tx
      .select({
        balance: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`,
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, targetUserId),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
        ),
      );
    const currentGold = Number(balanceRow?.balance ?? 0);

    if (direction === "subtract" && amount > currentGold) {
      throw createError({
        statusCode: 400,
        statusMessage: `Cannot subtract ${amount}: user only has ${currentGold} gold. Subtraction would push the balance negative.`,
      });
    }

    const [transaction] = await tx
      .insert(currencyTransactionTable)
      .values({
        user_id: targetUserId,
        amount,
        type: direction === "add" ? "increase" : "decrease",
        source: "admin_adjustment",
        memo: note,
        created_by_user_id: actorId,
        counts: true,
      })
      .returning({ id: currencyTransactionTable.id });

    return { currentGold, transaction };
  });

  const goldAfter = direction === "add" ? currentGold + amount : currentGold - amount;

  try {
    await writeAudit({
      actor_id: actorId,
      action: "adjust_user_gold",
      entity_type: "user",
      entity_id: targetUserId,
      old_value: { gold_balance: currentGold },
      new_value: {
        transaction_id: transaction?.id ?? null,
        amount,
        direction,
        type: direction === "add" ? "increase" : "decrease",
        source: "admin_adjustment",
        note,
        reason: reason ?? null,
        gold_balance: goldAfter,
        ...(via ? { via } : {}),
      },
      sensitive: true,
      public_message: note,
      change_summary: `${direction === "add" ? "Added" : "Subtracted"} ${amount} gold`,
    });
  } catch (error) {
    console.error("Failed to write audit log for gold adjustment", error);
  }

  const entityId = String(transaction?.id ?? "");
  if (reason === "show_and_tell_won") {
    await notify({
      user_id: targetUserId,
      type: "show_and_tell_won",
      title: "You won Show and Tell!",
      body: `Yay! People loved your project the best at Show and Tell. You've been awarded ${amount} gold for your winning submission. Keep building amazing things!`,
      action_url: "/currency",
      entity_type: "currency_transaction",
      entity_id: entityId,
      slack: {
        text: `:tada: *You won Show and Tell!* People loved your project the best, you've been awarded *${amount} gold*. Keep building amazing things! :tada:`,
      },
    });
  } else if (reason === "show_and_tell_participated") {
    await notify({
      user_id: targetUserId,
      type: "show_and_tell_participated",
      title: "Thanks for participating in Show and Tell!",
      body: `Thanks for sharing your project at Show and Tell! You've been awarded ${amount} gold for participating. We loved seeing what you built, keep it up!`,
      action_url: "/currency",
      entity_type: "currency_transaction",
      entity_id: entityId,
      slack: {
        text: `:clap: *Thanks for participating in Show and Tell!* You've been awarded *${amount} gold* for sharing your project. We loved seeing what you built!`,
      },
    });
  } else {
    await notify({
      user_id: targetUserId,
      type: "gold_adjusted",
      title:
        direction === "add"
          ? "Gold added to your balance"
          : "Gold removed from your balance",
      body: `${direction === "add" ? "+" : "-"}${amount} gold. ${note}`,
      action_url: "/currency",
      entity_type: "currency_transaction",
      entity_id: entityId,
      slack: {
        text:
          direction === "add"
            ? `:moneybag: A staff member added *${amount} gold* to your balance. ${note}`
            : `:money_with_wings: A staff member removed *${amount} gold* from your balance. ${note}`,
      },
    });
  }

  return {
    transactionId: transaction?.id ?? null,
    goldBefore: currentGold,
    goldAfter,
  };
}
