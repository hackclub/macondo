import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import db from "../../db";
import {
  currencyTransactionTable,
  npsResponseTable,
} from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import { getSession } from "../../lib/session";
import { countShippedShipsForUser } from "../../lib/ships";

const GOLD_REWARD = 10;
// Mirror of the value in eligibility.get.ts.
const NPS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type Body = {
  score?: number;
  doing_well?: string;
  can_improve?: string;
  anything_else?: string | null;
};

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = (await readBody<Body>(event)) ?? {};
  const score = Number(body.score);
  const doingWell = trim(body.doing_well);
  const canImprove = trim(body.can_improve);
  const anythingElseRaw = trim(body.anything_else);
  const anythingElse = anythingElseRaw.length > 0 ? anythingElseRaw : null;

  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw createError({
      statusCode: 400,
      statusMessage: "score must be an integer 1-10",
    });
  }
  if (doingWell.length < 3 || doingWell.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: "doing_well must be 3-2000 characters",
    });
  }
  if (canImprove.length < 3 || canImprove.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: "can_improve must be 3-2000 characters",
    });
  }
  if (anythingElse && anythingElse.length > 2000) {
    throw createError({
      statusCode: 400,
      statusMessage: "anything_else must be at most 2000 characters",
    });
  }

  const [npsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(npsResponseTable)
    .where(eq(npsResponseTable.user_id, user.id));
  const npsCount = Number(npsRow?.count ?? 0);

  const shippedCount = await countShippedShipsForUser(user.id);

  if (npsCount >= shippedCount + 1) {
    throw createError({
      statusCode: 429,
      statusMessage: "Ship a project to unlock another NPS submission",
      data: { unlockCondition: "ship_project", npsCount, shippedCount },
    });
  }

  // Mirrors the eligibility GET so the cooldown can't be skipped by calling this directly.
  if (npsCount > 0) {
    const [lastNps] = await db
      .select({ created_at: npsResponseTable.created_at })
      .from(npsResponseTable)
      .where(eq(npsResponseTable.user_id, user.id))
      .orderBy(desc(npsResponseTable.created_at))
      .limit(1);
    const lastAt = lastNps?.created_at
      ? new Date(lastNps.created_at).getTime()
      : null;
    if (lastAt !== null && Date.now() - lastAt < NPS_COOLDOWN_MS) {
      throw createError({
        statusCode: 429,
        statusMessage: "You can fill this out again 7 days after your last submission.",
        data: {
          unlockCondition: "wait_cooldown",
          npsCount,
          shippedCount,
          nextEligibleAt: new Date(lastAt + NPS_COOLDOWN_MS).toISOString(),
        },
      });
    }
  }

  const insertedId = await db.transaction(async (tx) => {
    // Per-user lock so concurrent submits can't both pass and award double gold.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${user.id})::bigint)`);

    // Re-check inside the lock: a concurrent submission may have bumped the count.
    const [recheckRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(npsResponseTable)
      .where(eq(npsResponseTable.user_id, user.id));
    const recheckCount = Number(recheckRow?.count ?? 0);
    if (recheckCount >= shippedCount + 1) {
      throw createError({
        statusCode: 429,
        statusMessage: "Ship a project to unlock another NPS submission",
        data: { unlockCondition: "ship_project", npsCount: recheckCount, shippedCount },
      });
    }

    const [inserted] = await tx
      .insert(npsResponseTable)
      .values({
        user_id: user.id,
        score,
        doing_well: doingWell,
        can_improve: canImprove,
        anything_else: anythingElse,
      })
      .returning({ id: npsResponseTable.id });

    await tx.insert(currencyTransactionTable).values({
      user_id: user.id,
      amount: GOLD_REWARD,
      type: "increase",
      source: "nps_feedback",
      memo: "NPS feedback submitted",
      counts: true,
      fruit_type: null,
    });

    return inserted!.id;
  });

  const [balanceRow] = await db
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
        isNull(currencyTransactionTable.fruit_type),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    );

  await writeAudit({
    actor_id: user.id,
    action: "nps_submitted",
    entity_type: "nps_response",
    entity_id: String(insertedId),
    new_value: { score },
    public_message: `Submitted NPS feedback (score: ${score})`,
    change_summary: `NPS score: ${score}`,
  });

  return {
    ok: true,
    goldAwarded: GOLD_REWARD,
    newBalance: Number(balanceRow?.balance ?? 0),
    unlockCondition: "ship_project",
  };
});
