import { getSession } from "~~/server/lib/session";
import {
  ensureReferralCode,
  countValidReferrals,
  countPendingReferrals,
  getClaimedTiers,
  REFERRAL_TIERS,
  summarizeRewards,
} from "~~/server/lib/referrals";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const code = await ensureReferralCode(user.id);
  const [validCount, pendingCount, claimedTiers] = await Promise.all([
    countValidReferrals(user.id),
    countPendingReferrals(user.id),
    getClaimedTiers(user.id),
  ]);
  const claimedSet = new Set(claimedTiers);

  return {
    code,
    validReferralCount: validCount,
    pendingReferralCount: pendingCount,
    tiers: REFERRAL_TIERS.map((t) => ({
      tier: t.tier,
      requiredCount: t.requiredCount,
      title: t.title,
      goldAmount: t.goldAmount,
      rewardSummary: summarizeRewards(t),
      claimed: claimedSet.has(t.tier),
      unlocked: validCount >= t.requiredCount,
    })),
  };
});
