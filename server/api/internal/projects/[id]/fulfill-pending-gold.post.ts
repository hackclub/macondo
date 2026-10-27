import { and, eq, isNull, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  projectTable,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { notify } from "../../../../lib/notify";
import { canFulfillPendingGold } from "../../../../policies/internal";

// Escape hatch for makers who legitimately cannot build: releases pending gold
// without a build-complete ship, mirroring the unlock in finalize-ship-approval.ts.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canFulfillPendingGold(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const reason = (await readBody<{ reason?: string }>(event)).reason?.trim();
  if (!reason || reason.length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reason is required for the audit trail",
    });
  }

  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      user_id: projectTable.user_id,
    })
    .from(projectTable)
    .where(eq(projectTable.id, id))
    .limit(1);

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const now = new Date();
  const memoSuffix = ` [pending gold manually fulfilled by staff: ${reason}]`;

  // same lock as finalize-ship-approval.ts so a concurrent approval can't flip these rows twice
  const unlockedRows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${project.id}::bigint)`);

    return tx
      .update(currencyTransactionTable)
      .set({
        unlocked_at: now,
        memo: sql`COALESCE(${currencyTransactionTable.memo}, '') || ${memoSuffix}`,
      })
      .where(
        and(
          eq(currencyTransactionTable.pending_for_project_id, project.id),
          isNull(currencyTransactionTable.unlocked_at),
          eq(currencyTransactionTable.counts, true),
        ),
      )
      .returning({
        id: currencyTransactionTable.id,
        amount: currencyTransactionTable.amount,
        user_id: currencyTransactionTable.user_id,
      });
  });

  if (unlockedRows.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "This project has no pending gold to fulfill",
    });
  }

  const totalUnlocked = unlockedRows.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );

  // per maker so group projects notify each contributor with their own share
  const totalsByUser = new Map<string, number>();
  for (const row of unlockedRows) {
    totalsByUser.set(
      row.user_id,
      (totalsByUser.get(row.user_id) ?? 0) + Number(row.amount ?? 0),
    );
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "unlock_pending_fruit",
      entity_type: "fruit_unlock_batch",
      entity_id: String(project.id),
      old_value: null,
      new_value: {
        project_id: project.id,
        manual: true,
        reason,
        unlocked_tx_ids: unlockedRows.map((r) => r.id),
        total_gold: totalUnlocked,
        affected_user_ids: [...totalsByUser.keys()],
      },
      sensitive: false,
      public_message: `Manually unlocked ${totalUnlocked} pending gold for ${project.name} (maker could not build)`,
      change_summary: project.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for manual pending unlock", error);
  }

  const projectUrl = `/projects/${project.id}`;
  for (const [userId, amount] of totalsByUser) {
    await notify({
      user_id: userId,
      type: "pending_fruit_unlocked",
      title: `Pending gold unlocked for ${project.name}`,
      body: `A staff member released ${amount} gold that was waiting on this project's build. ${reason}`,
      action_url: projectUrl,
      entity_type: "project",
      entity_id: String(project.id),
      slack: {
        text: `:unlock: *${project.name}* pending gold released by staff. ${amount} gold unlocked.`,
      },
    });
  }

  return {
    ok: true,
    totalUnlocked,
    rowCount: unlockedRows.length,
    userCount: totalsByUser.size,
  };
});
