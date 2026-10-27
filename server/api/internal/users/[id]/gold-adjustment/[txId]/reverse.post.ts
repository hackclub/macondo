import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import db from "../../../../../../db";
import { currencyTransactionTable } from "../../../../../../db/schema";
import { writeAudit } from "../../../../../../lib/audit";
import { notify } from "../../../../../../lib/notify";
import { canAdjustUserGold } from "../../../../../../policies/internal";

// The ledger row is flipped to counts=false rather than deleted, preserving history.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAdjustUserGold(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const txId = Number(getRouterParam(event, "txId"));
  if (!Number.isInteger(txId) || txId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid transaction" });
  }

  const body = await readBody<{ note?: string }>(event);
  const reverseNote = body.note?.trim() || null;

  const [tx] = await db
    .select({
      id: currencyTransactionTable.id,
      user_id: currencyTransactionTable.user_id,
      amount: currencyTransactionTable.amount,
      type: currencyTransactionTable.type,
      source: currencyTransactionTable.source,
      counts: currencyTransactionTable.counts,
      fruit_type: currencyTransactionTable.fruit_type,
      memo: currencyTransactionTable.memo,
    })
    .from(currencyTransactionTable)
    .where(eq(currencyTransactionTable.id, txId))
    .limit(1);

  if (!tx || tx.user_id !== id) {
    throw createError({ statusCode: 404, statusMessage: "Adjustment not found" });
  }
  if (tx.source !== "admin_adjustment" || tx.fruit_type !== null) {
    throw createError({
      statusCode: 400,
      statusMessage: "Only manual gold adjustments can be reversed here",
    });
  }
  if (!tx.counts) {
    throw createError({
      statusCode: 400,
      statusMessage: "This adjustment has already been reversed",
    });
  }

  const amount = Number(tx.amount);
  const wasAdd = tx.type === "increase";

  // If the maker spent the added gold, reversing would push the balance negative;
  // a fresh subtraction or grant clawback is the path then.
  if (wasAdd) {
    const [balanceRow] = await db
      .select({
        balance: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`,
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, id),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
        ),
      );
    const currentGold = Number(balanceRow?.balance ?? 0);
    if (currentGold < amount) {
      throw createError({
        statusCode: 400,
        statusMessage: `Cannot reverse: the user has spent some of this gold (balance ${currentGold} < ${amount}).`,
      });
    }
  }

  await db
    .update(currencyTransactionTable)
    .set({
      counts: false,
      memo: `${tx.memo ?? ""} [reversed by ${actor.name ?? actor.id}: ${reverseNote ?? "no reason given"}]`.trim(),
    })
    .where(eq(currencyTransactionTable.id, txId));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "reverse_user_gold_adjustment",
      entity_type: "user",
      entity_id: id,
      old_value: {
        transaction_id: txId,
        counts: true,
        type: tx.type,
        amount,
      },
      new_value: {
        transaction_id: txId,
        counts: false,
        reverse_note: reverseNote,
      },
      sensitive: true,
      public_message: reverseNote,
      change_summary: `Reversed a manual gold ${wasAdd ? "addition" : "subtraction"} of ${amount}`,
    });
  } catch (error) {
    console.error("Failed to write audit log for gold adjustment reversal", error);
  }

  const reverseBody = wasAdd
    ? `${amount} gold previously added to your balance was removed.${reverseNote ? ` ${reverseNote}` : ""}`
    : `${amount} gold previously removed from your balance was restored.${reverseNote ? ` ${reverseNote}` : ""}`;
  await notify({
    user_id: id,
    type: "gold_adjusted",
    title: "A gold adjustment was reversed",
    body: reverseBody,
    action_url: "/currency",
    entity_type: "currency_transaction",
    entity_id: String(txId),
    slack: {
      text: `:arrows_counterclockwise: ${reverseBody}`,
    },
  });

  return { ok: true };
});
