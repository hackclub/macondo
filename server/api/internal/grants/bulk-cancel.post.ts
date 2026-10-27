import { eq, inArray, sql } from "drizzle-orm";

import db from "../../../db";
import {
  currencyTransactionTable,
  projectGrantTable,
  projectTable,
  shipTable,
  users,
} from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { createHcbClient } from "../../../lib/hcb";
import { computeFruitReward, computeGoldReward, parseLevel } from "../../../lib/rewards";
import {
  effectiveStreakDaysForShip,
  projectMultiplier,
} from "../../../lib/streaks";
import { canAccessInternalShopAdmin } from "../../../policies/internal";
import {
  getFruitsByLevelAndCategory,
  type ProjectCategory,
} from "../../../../app/data/fruitLevels";

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error &&
    "statusMessage" in error &&
    typeof (error as { statusMessage?: string }).statusMessage === "string"
  ) {
    return (error as { statusMessage: string }).statusMessage;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

// Same per-grant logic as the single cancel endpoint; each row reports its own pass/fail.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{
    ids?: number[];
    reason?: string | null;
    awardFruit?: boolean | null;
  }>(event);
  const ids = Array.from(
    new Set((Array.isArray(body?.ids) ? body.ids : []).filter((n) => Number.isInteger(n) && (n as number) > 0)),
  ) as number[];
  const reason = body?.reason?.trim() || null;
  const awardFruit = body?.awardFruit === true;

  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No grant IDs supplied" });
  }
  if (ids.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: "At most 100 grants can be cancelled in one batch",
    });
  }
  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "A cancel reason is required",
    });
  }

  const grants = await db
    .select()
    .from(projectGrantTable)
    .where(inArray(projectGrantTable.id, ids));
  const grantById = new Map(grants.map((g) => [g.id, g]));

  const hcbClient = createHcbClient();

  type CancelResult = {
    id: number;
    ok: boolean;
    error?: string;
    fruit_awarded?: number;
  };
  const results: CancelResult[] = [];

  // Audit failed attempts too; the happy path writes its own cancel_project_grant audit.
  async function auditBulkFailure(
    targetId: number,
    errorMessage: string,
    grant: typeof grants[number] | undefined,
  ) {
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "cancel_project_grant_failed",
        entity_type: "project_grant",
        entity_id: String(targetId),
        old_value: grant ?? null,
        new_value: { error: errorMessage, reason, awardFruit },
        sensitive: true,
        public_message: `Bulk grant cancel failed: ${errorMessage}`,
      });
    } catch (e) {
      console.error("Failed to write audit log for bulk cancel failure", e);
    }
  }

  for (const id of ids) {
    const grant = grantById.get(id);
    if (!grant) {
      results.push({ id, ok: false, error: "Grant not found" });
      await auditBulkFailure(id, "Grant not found", undefined);
      continue;
    }
    if (grant.status !== "queued" && grant.status !== "sent") {
      const msg = `Grant is ${grant.status}; skipped`;
      results.push({ id, ok: false, error: msg });
      await auditBulkFailure(id, msg, grant);
      continue;
    }

    // Sent grants require HCB to accept the cancel before we touch our row.
    if (grant.status === "sent" && grant.hcb_grant_id) {
      try {
        await hcbClient.cancelCardGrant(grant.hcb_grant_id);
      } catch (err) {
        const msg = `HCB refused cancel: ${getErrorMessage(err, "unknown")}`;
        results.push({ id, ok: false, error: msg });
        await auditBulkFailure(id, msg, grant);
        continue;
      }
    }

    try {
      const { fruitAmount, updatedGrant } = await db.transaction(async (tx) => {
        let fruitTxId: number | null = null;
        let fruitAmount = 0;

        if (awardFruit) {
          const [ship] = await tx
            .select()
            .from(shipTable)
            .where(eq(shipTable.id, grant.ship_id))
            .limit(1);
          if (!ship) {
            throw createError({
              statusCode: 404,
              statusMessage: "Ship not found for grant",
            });
          }
          const [project] = await tx
            .select()
            .from(projectTable)
            .where(eq(projectTable.id, grant.project_id))
            .limit(1);
          if (!project) {
            throw createError({
              statusCode: 404,
              statusMessage: "Project not found for grant",
            });
          }
          const level = parseLevel(project.level);
          if (!level) {
            throw createError({
              statusCode: 400,
              statusMessage: "Project has no valid level; cannot compute fallback gold",
            });
          }
          const approvedHours = ship.override_hours ?? 0;
          const baseGold = computeGoldReward(approvedHours, level);
          const baseFruit = computeFruitReward(approvedHours, level);
          // Mirror the approve-path multiplier (max of snapshot and live) so the fallback matches the original award.
          const streakDays = effectiveStreakDaysForShip({
            snapshot: ship.project_streak_days_at_submission,
            liveStreakDays: project.project_streak_days ?? 0,
          });
          const multiplier = projectMultiplier(streakDays);
          const goldAmount = Math.floor(baseGold * multiplier);
          const lifetimeFruitDelta = Math.floor(baseFruit * multiplier);
          fruitAmount = goldAmount;

          if (goldAmount > 0) {
            const [tx1] = await tx
              .insert(currencyTransactionTable)
              .values({
                user_id: grant.user_id,
                amount: goldAmount,
                type: "increase",
                source: "staff_reward",
                ship_id: grant.ship_id,
                fruit_type: null,
                created_by_user_id: actor.id,
                memo: `Bulk-cancelled HCB grant #${grant.id}: gold fallback awarded by ${actor.name ?? actor.id}`,
                counts: true,
              })
              .returning({ id: currencyTransactionTable.id });
            fruitTxId = tx1?.id ?? null;

            if (lifetimeFruitDelta > 0) {
              const fallbackFruit =
                getFruitsByLevelAndCategory(
                  level,
                  (project.type === "hardware" ? "hardware" : "software") satisfies ProjectCategory,
                )[0]?.name ?? null;
              if (fallbackFruit) {
                await tx
                  .update(users)
                  .set({
                    lifetime_fruits_earned: sql`
                      jsonb_set(
                        COALESCE(${users.lifetime_fruits_earned}, '{}'::jsonb),
                        ARRAY[${fallbackFruit}]::text[],
                        to_jsonb(
                          COALESCE((${users.lifetime_fruits_earned} ->> ${fallbackFruit})::numeric, 0)
                          + ${lifetimeFruitDelta}::numeric
                        ),
                        true
                      )
                    `,
                  })
                  .where(eq(users.id, grant.user_id));
              }
            }
          }
        }

        const [updated] = await tx
          .update(projectGrantTable)
          .set({
            status: "cancelled",
            cancelled_by_user_id: actor.id,
            cancelled_at: new Date(),
            cancel_reason: reason,
            cancel_fruit_tx_id: fruitTxId,
            updated_at: new Date(),
          })
          .where(eq(projectGrantTable.id, id))
          .returning();

        if (!updated) {
          throw createError({
            statusCode: 500,
            statusMessage: "Failed to cancel grant",
          });
        }

        return { updatedGrant: updated, fruitTxId, fruitAmount };
      });

      try {
        await writeAudit({
          actor_id: actor.id,
          action: "cancel_project_grant",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: grant,
          new_value: updatedGrant,
          sensitive: true,
          public_message: `Bulk grant cancelled: ${reason}`,
        });
      } catch (e) {
        console.error("Failed to write audit log for bulk cancel", e);
      }

      results.push({ id, ok: true, fruit_awarded: fruitAmount });
    } catch (err) {
      const msg = getErrorMessage(err, "cancel failed");
      results.push({ id, ok: false, error: msg });
      await auditBulkFailure(id, msg, grant);
    }
  }

  const cancelledCount = results.filter((r) => r.ok).length;

  return {
    requested: ids.length,
    cancelled: cancelledCount,
    failed: results.length - cancelledCount,
    results,
  };
});
