import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import db from "../../../../db";
import { currencyTransactionTable, macondoBanTable, users } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import {
  type BanGoldPenalty,
  enforceMacondoBanInSlack,
  getActiveMacondoBan,
} from "../../../../lib/macondo-ban";
import { canBanUser } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canBanUser(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id")!;
  const body = await readBody<{
    reason: string;
    type?: "temp" | "perm";
    expires_in_hours?: number;
    // 0-100 share of spendable gold to remove; omit or 0 to leave gold untouched.
    gold_removal_percent?: number;
  }>(event);

  const reason = body.reason?.trim();
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: "Reason required" });
  }

  let goldPercent = 0;
  if (body.gold_removal_percent !== undefined && body.gold_removal_percent !== null) {
    const pct = Number(body.gold_removal_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw createError({
        statusCode: 400,
        statusMessage: "gold_removal_percent must be between 0 and 100",
      });
    }
    goldPercent = pct;
  }

  const isTemp = body.type === "temp";
  let expiresAt: Date | null = null;
  if (isTemp) {
    const hours = Number(body.expires_in_hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "A positive expires_in_hours is required for a temp ban",
      });
    }
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  const [target] = await db
    .select({ id: users.id, slack_id: users.slack_id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  if (await getActiveMacondoBan(id)) {
    throw createError({
      statusCode: 409,
      statusMessage: "User is already banned",
    });
  }

  const [ban] = await db
    .insert(macondoBanTable)
    .values({
      user_id: id,
      reason,
      expires_at: expiresAt,
      created_by_user_id: actor.id,
    })
    .returning();

  // Same balance definition as gold-adjustment; floored so we never remove a fraction.
  let goldPenalty: BanGoldPenalty | null = null;
  if (goldPercent > 0) {
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
    const removed = Math.floor((currentGold * goldPercent) / 100);

    if (removed > 0) {
      const memo = `Ban penalty: ${goldPercent}% of gold removed (${reason})`;
      const [tx] = await db
        .insert(currencyTransactionTable)
        .values({
          user_id: id,
          amount: removed,
          type: "decrease",
          source: "admin_adjustment",
          memo,
          created_by_user_id: actor.id,
          counts: true,
        })
        .returning({ id: currencyTransactionTable.id });

      goldPenalty = {
        percent: goldPercent,
        removed,
        remaining: currentGold - removed,
      };

      try {
        await writeAudit({
          actor_id: actor.id,
          action: "adjust_user_gold",
          entity_type: "user",
          entity_id: id,
          old_value: { gold_balance: currentGold },
          new_value: {
            transaction_id: tx?.id ?? null,
            amount: removed,
            direction: "subtract",
            type: "decrease",
            source: "admin_adjustment",
            note: memo,
            percent: goldPercent,
            via: "macondo_ban",
            gold_balance: currentGold - removed,
          },
          sensitive: true,
          public_message: memo,
          change_summary: `Removed ${removed} gold (${goldPercent}%) via ban`,
        });
      } catch (e) {
        console.error("Failed to write audit log for ban gold penalty", e);
      }
    } else {
      // Record the intent so the DM still reflects the requested penalty.
      goldPenalty = { percent: goldPercent, removed: 0, remaining: currentGold };
    }
  }

  // Best-effort; never blocks the ban write.
  await enforceMacondoBanInSlack({
    slackId: target.slack_id,
    reason,
    expiresAt,
    gold: goldPenalty,
  });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "create_macondo_ban",
      entity_type: "user",
      entity_id: id,
      old_value: null,
      new_value: {
        reason,
        type: isTemp ? "temp" : "perm",
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        created_by: actor.id,
        gold_removal_percent: goldPercent || null,
        gold_removed: goldPenalty?.removed ?? 0,
      },
      sensitive: true,
      public_message: null,
    });
  } catch (e) {
    console.error("Failed to write audit log for macondo ban", e);
  }

  return { ok: true, ban, goldPenalty };
});
