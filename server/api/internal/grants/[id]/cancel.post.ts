import { eq, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  projectGrantTable,
  projectTable,
  shipTable,
  users,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { createHcbClient } from "../../../../lib/hcb";
import { notify } from "../../../../lib/notify";
import { computeFruitReward, computeGoldReward, parseLevel } from "../../../../lib/rewards";
import {
  effectiveStreakDaysForShip,
  projectMultiplier,
} from "../../../../lib/streaks";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";
import {
  getFruitsByLevelAndCategory,
  type ProjectCategory,
} from "../../../../../app/data/fruitLevels";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid grant ID" });
  }

  const body = await readBody<{
    reason?: string | null;
    awardFruit?: boolean | null;
  }>(event);
  const reason = body?.reason?.trim() || null;
  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "A cancel reason is required",
    });
  }
  const awardFruit = body?.awardFruit === true;

  const [grant] = await db
    .select()
    .from(projectGrantTable)
    .where(eq(projectGrantTable.id, id))
    .limit(1);

  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: "Grant not found" });
  }
  if (grant.status !== "queued" && grant.status !== "sent") {
    throw createError({
      statusCode: 409,
      statusMessage: `Grant is ${grant.status} and cannot be cancelled.`,
    });
  }

  // Cancel on HCB first so our row never shows cancelled while the card is live; on refusal the admin can retry.
  if (grant.status === "sent" && grant.hcb_grant_id) {
    try {
      await createHcbClient().cancelCardGrant(grant.hcb_grant_id);
    } catch (err) {
      const msg =
        (err as { statusMessage?: string; message?: string })?.statusMessage ??
        (err as Error)?.message ??
        "HCB cancel failed";
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "cancel_project_grant_failed",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: grant,
          new_value: { error: msg, reason, awardFruit, hcb_stage: "hcb_refused" },
          sensitive: true,
          public_message: `HCB refused to cancel grant: ${msg}`,
        });
      } catch (e) {
        console.error(
          "Failed to write audit log for cancel_project_grant_failed",
          e,
        );
      }
      throw createError({
        statusCode: 502,
        statusMessage: `HCB refused to cancel the grant: ${msg}`,
      });
    }
  }

  // awardFruit keeps its name for wire compatibility but pays gold; lifetime_fruits_earned still advances.
  const { updatedGrant, fruitTxId, fruitAmount } = await db.transaction(async (tx) => {
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
            memo: `Cancelled HCB grant #${grant.id}: gold fallback awarded by ${actor.name ?? actor.id} (${approvedHours}h, ${goldAmount} gold)`,
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
    const suffix = awardFruit
      ? fruitTxId
        ? ` (fallback ${fruitAmount} gold awarded)`
        : " (fallback gold requested but amount was 0)"
      : " (no payout)";
    await writeAudit({
      actor_id: actor.id,
      action: "cancel_project_grant",
      entity_type: "project_grant",
      entity_id: String(id),
      old_value: grant,
      new_value: updatedGrant,
      sensitive: true,
      public_message: `Grant cancelled${suffix}: ${reason}`,
    });
  } catch (e) {
    console.error("Failed to write audit log for cancel_project_grant", e);
  }

  const [projectRow] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, grant.project_id))
    .limit(1);
  const projectName = projectRow?.name ?? `project #${grant.project_id}`;
  const projectUrl = `${publicBaseUrl()}/projects/${grant.project_id}`;
  void notify({
    user_id: grant.user_id,
    type: "grant_cancelled",
    title: `Grant for ${projectName} cancelled`,
    body: awardFruit && fruitAmount > 0
      ? `Your grant was cancelled. Reason: ${reason}. ${fruitAmount} gold awarded as fallback.`
      : `Your grant was cancelled. Reason: ${reason}.`,
    action_url: projectUrl,
    entity_type: "project_grant",
    entity_id: String(id),
    slack: {
      text: `:no_entry_sign: Your grant for *${projectName}* was cancelled by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""}.\n>${reason}`,
    },
    email: {
      template: "grant_cancelled",
      data: {
        project_name: projectName,
        reason,
        project_url: projectUrl,
      },
    },
  });

  return updatedGrant;
});
