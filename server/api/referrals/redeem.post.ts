import { sql } from "drizzle-orm";
import db from "~~/server/db";
import { referralRedemptionsTable, currencyTransactionTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import {
  countValidReferrals,
  REFERRAL_TIERS,
  summarizeRewards,
} from "~~/server/lib/referrals";
import { writeAudit } from "~~/server/lib/audit";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const tierNum = Number((await readBody<{ tier?: number }>(event))?.tier);
  if (!Number.isInteger(tierNum) || tierNum < 1) {
    throw createError({ statusCode: 400, statusMessage: "Invalid tier" });
  }

  const tier = REFERRAL_TIERS.find((t) => t.tier === tierNum);
  if (!tier) {
    throw createError({ statusCode: 404, statusMessage: "Tier not found" });
  }

  const validCount = await countValidReferrals(user.id);
  if (validCount < tier.requiredCount) {
    throw createError({
      statusCode: 400,
      statusMessage: `Need ${tier.requiredCount} referrals (you have ${validCount})`,
    });
  }

  const existing = await db
    .select({ id: referralRedemptionsTable.id })
    .from(referralRedemptionsTable)
    .where(
      sql`${referralRedemptionsTable.user_id} = ${user.id} AND ${referralRedemptionsTable.tier} = ${tierNum}`,
    )
    .limit(1);
  if (existing[0]) {
    throw createError({ statusCode: 409, statusMessage: "Already redeemed" });
  }

  const summary = summarizeRewards(tier);

  // One transaction, or a failed gold insert would lock the tier (unique index) without awarding gold.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(referralRedemptionsTable).values({
        user_id: user.id,
        tier: tierNum,
        reward_summary: summary,
      });

      await tx.insert(currencyTransactionTable).values({
        user_id: user.id,
        amount: tier.goldAmount,
        type: "increase",
        source: "referral_reward",
        fruit_type: null,
        memo: `Referral tier ${tierNum} (${tier.title}) reward`,
        counts: true,
      });
    });
  } catch (err: unknown) {
    const msg = String((err as { message?: string })?.message ?? "");
    if (msg.includes("duplicate") || msg.includes("unique")) {
      throw createError({ statusCode: 409, statusMessage: "Already redeemed" });
    }
    throw err;
  }

  try {
    await writeAudit({
      actor_id: user.id,
      action: "redeem_referral_tier",
      entity_type: "user",
      entity_id: user.id,
      old_value: null,
      new_value: { tier: tierNum, summary },
      sensitive: false,
      public_message: `Redeemed referral tier ${tierNum} (${summary})`,
    });
  } catch (err) {
    console.error("[referrals] audit write failed", err);
  }

  return { ok: true, tier: tierNum, rewardSummary: summary };
});
