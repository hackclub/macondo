import { desc, eq, sql } from "drizzle-orm";

import db from "../../db";
import { npsResponseTable } from "../../db/schema";
import { getSession } from "../../lib/session";
import { countShippedShipsForUser } from "../../lib/ships";

// One free submission, plus one per approved ship; every submission after the
// first also waits out a 7-day cooldown.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const [npsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(npsResponseTable)
    .where(eq(npsResponseTable.user_id, user.id));
  const npsCount = Number(npsRow?.count ?? 0);

  // A collaborator's ship row belongs to the owner, so count both roles.
  const shippedCount = await countShippedShipsForUser(user.id);

  const passesCountGate = npsCount < shippedCount + 1;

  let passesCooldown = true;
  if (npsCount > 0) {
    const [lastNps] = await db
      .select({ created_at: npsResponseTable.created_at })
      .from(npsResponseTable)
      .where(eq(npsResponseTable.user_id, user.id))
      .orderBy(desc(npsResponseTable.created_at))
      .limit(1);
    const lastAt = lastNps?.created_at ? new Date(lastNps.created_at).getTime() : null;
    if (lastAt !== null) {
      passesCooldown = Date.now() - lastAt >= 7 * 24 * 60 * 60 * 1000;
    }
  }

  const eligible = passesCountGate && passesCooldown;

  // Surface the more actionable unlock: a fresh ship before a time-based wait.
  let unlockCondition: "ship_project" | "wait_cooldown" | null = null;
  if (!eligible) {
    if (!passesCountGate) unlockCondition = "ship_project";
    else if (!passesCooldown) unlockCondition = "wait_cooldown";
  }

  return {
    eligible,
    npsCount,
    shippedCount,
    unlockCondition,
  };
});
