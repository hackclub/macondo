// Releases the identity sweep's gold hold (decreases tagged IDENTITY_HOLD_MEMO_MARKER).
// Idempotent: safe to call repeatedly and for users with no hold.

import { and, eq, isNull, sql } from "drizzle-orm";

import db from "../db";
import { currencyTransactionTable } from "../db/schema";
import { writeAudit } from "./audit";

export const IDENTITY_HOLD_MEMO_MARKER = "[identity-verification-hold]";
export const IDENTITY_HOLD_RELEASE_MEMO_MARKER =
  "[identity-verification-hold-release]";

// Errors propagate; callers catch so a failed release never breaks sign-in or the cron.
export async function releaseIdentityHold(userId: string): Promise<number> {
  const released = await db.transaction(async (tx) => {
    // Same per-user lock as the shop paths, so concurrent sign-ins can't double-release.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`,
    );

    // The hold marker ends in "]" so it never substring-matches the release marker.
    const [row] = await tx
      .select({
        held: sql<number>`coalesce(sum(
          case
            when ${currencyTransactionTable.type} = 'decrease'
              and ${currencyTransactionTable.memo} like ${`%${IDENTITY_HOLD_MEMO_MARKER}%`}
              then ${currencyTransactionTable.amount}
            when ${currencyTransactionTable.type} = 'increase'
              and ${currencyTransactionTable.memo} like ${`%${IDENTITY_HOLD_RELEASE_MEMO_MARKER}%`}
              then -${currencyTransactionTable.amount}
            else 0
          end
        ), 0)::float8`,
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, userId),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
        ),
      );

    const amount = Math.round(Number(row?.held ?? 0) * 10000) / 10000; // round to 4 decimals
    if (amount <= 0) return 0;

    await tx.insert(currencyTransactionTable).values({
      user_id: userId,
      amount,
      type: "increase",
      source: "system",
      memo: `${IDENTITY_HOLD_RELEASE_MEMO_MARKER} Identity verified, held gold returned.`,
      counts: true,
    });

    return amount;
  });

  if (released > 0) {
    try {
      await writeAudit({
        actor_id: userId,
        action: "identity_verification_hold_released",
        entity_type: "users",
        entity_id: userId,
        new_value: { released_gold: released },
        sensitive: false,
        public_message: `Identity verified, ${released} held gold returned automatically.`,
      });
    } catch (err) {
      console.error(
        "[identity-hold] audit write failed for release",
        userId,
        err,
      );
    }
  }

  return released;
}
