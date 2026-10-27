import { randomInt } from "node:crypto";
import { and, eq, sql, count, ne, isNotNull, isNull, or } from "drizzle-orm";
import db from "../db";
import { users, referralRedemptionsTable } from "../db/schema";

// Excludes 0, O, I, 1 to avoid read-ambiguity; uppercase only since input is uppercased.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

export function generateCodeString(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (cleaned.length !== CODE_LENGTH) return null;
  return cleaned;
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await db
    .select({ referral_code: users.referral_code })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing[0]?.referral_code) return existing[0].referral_code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCodeString();
    try {
      const updated = await db
        .update(users)
        .set({ referral_code: code })
        .where(and(eq(users.id, userId), sql`${users.referral_code} IS NULL`))
        .returning({ code: users.referral_code });
      if (updated[0]?.code) return updated[0].code;
      // Another request set it concurrently.
      const reread = await db
        .select({ code: users.referral_code })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (reread[0]?.code) return reread[0].code;
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message ?? "");
      if (!msg.includes("duplicate") && !msg.includes("unique")) throw err;
      // collision, retry
    }
  }
  throw new Error("Failed to generate unique referral code after 10 attempts");
}

export async function resolveReferralCode(
  code: string,
  selfUserId: string,
): Promise<string | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  return (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.referral_code, normalized), ne(users.id, selfUserId)))
      .limit(1)
  )[0]?.id ?? null;
}

// Only fully HCA-verified identities count, to block spam, abandoned signups
// and accounts stuck in HCA review.
export async function countValidReferrals(userId: string): Promise<number> {
  return Number(
    (
      await db
        .select({ n: count() })
        .from(users)
        .where(
          and(
            eq(users.referred_by_user_id, userId),
            eq(users.is_temp, false),
            ne(users.onboarding_step, "welcome"),
            isNotNull(users.sub),
            eq(users.hca_verification_status, "verified"),
          ),
        )
    )[0]?.n ?? 0,
  );
}

// Lets the dashboard show pending friends instead of silently dropping them.
export async function countPendingReferrals(userId: string): Promise<number> {
  return Number(
    (
      await db
        .select({ n: count() })
        .from(users)
        .where(
          and(
            eq(users.referred_by_user_id, userId),
            or(
              eq(users.is_temp, true),
              eq(users.onboarding_step, "welcome"),
              isNull(users.sub),
              isNull(users.hca_verification_status),
              ne(users.hca_verification_status, "verified"),
            ),
          ),
        )
    )[0]?.n ?? 0,
  );
}

export interface ReferralTier {
  tier: number;
  requiredCount: number;
  title: string;
  goldAmount: number;
}

// Gold per referral escalates at higher tiers to push past the first easy invite.
export const REFERRAL_TIERS: ReferralTier[] = [
  { tier: 1, requiredCount: 1, title: "Seedling", goldAmount: 3 },
  { tier: 2, requiredCount: 3, title: "Harvest", goldAmount: 10 },
  { tier: 3, requiredCount: 5, title: "Coffee Grower", goldAmount: 25 },
  { tier: 4, requiredCount: 10, title: "Plantation Keeper", goldAmount: 100 },
  { tier: 5, requiredCount: 25, title: "Patriarch of Macondo", goldAmount: 250 },
];

export function summarizeRewards(tier: ReferralTier): string {
  return `${tier.goldAmount} gold`;
}

export async function getClaimedTiers(userId: string): Promise<number[]> {
  return (
    await db
      .select({ tier: referralRedemptionsTable.tier })
      .from(referralRedemptionsTable)
      .where(eq(referralRedemptionsTable.user_id, userId))
  ).map((r) => r.tier);
}
