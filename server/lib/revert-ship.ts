// In-transaction conflicts must throw to roll the transaction back.

import { and, eq, inArray, sql } from "drizzle-orm";

import db from "../db";
import {
  currencyTransactionTable,
  projectGrantTable,
  projectTable,
  shipTable,
  users,
} from "../db/schema";
import { invalidateProject } from "./cache";
import { writeAudit } from "./audit";
import { clawBackUntilNonNegative } from "./clawback";
import { createHcbClient } from "./hcb";
import { alertHcbGrantNeedsManualReturn } from "./hcb-grant-return-alert";
import { notify } from "./notify";
import { returnHcbGrantAndRefund } from "./shop";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export interface RevertShipApprovalArgs {
  shipId: number;
  // Credited on the audit rows and grant cancellations.
  actorId: string;
  // Lands in the audit log and grant cancel_reason; never shown to the student.
  internalNotes: string;
  publicNotes?: string | null;
}

export interface RevertShipApprovalResult {
  ship: typeof shipTable.$inferSelect;
  cancelledGrantCount: number;
  cancelledSentGrantCount: number;
  disabledCurrencyTransactionCount: number;
  restoredPendingCurrencyTransactionCount: number;
  clawBackDisabledCurrencyTransactionCount: number;
  clawBackCancelledShopOrderCount: number;
  // Orders the clawback left intact, revoked after the tx. Failures need a manual return.
  hcbGrantOrdersRevokedCount: number;
  hcbGrantOrdersReturnFailedCount: number;
}

/** Throws createError on every failure path (404, 409 conflict, 502 HCB refusal). */
export async function revertShipApproval(
  args: RevertShipApprovalArgs,
): Promise<RevertShipApprovalResult> {
  const { shipId: id, actorId, internalNotes } = args;
  const publicNotes = args.publicNotes?.trim() || null;

  const [ship] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.id, id))
    .limit(1);

  if (!ship) {
    throw createError({ statusCode: 404, statusMessage: "Ship not found" });
  }

  if (ship.status !== "shipped" && ship.status !== "shipped_missing_airtable") {
    throw createError({
      statusCode: 409,
      statusMessage: `Ship is ${ship.status}; only approved ships can be reverted.`,
    });
  }

  const [project] = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const activeGrants = await db
    .select()
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.ship_id, id),
        inArray(projectGrantTable.status, ["queued", "sent"]),
      ),
    );

  // HCB first so a grant is never marked cancelled while its card is active;
  // outside the transaction so the project lock isn't held across network calls.
  const sentGrants = activeGrants.filter((grant) => grant.status === "sent");
  if (sentGrants.length > 0) {
    const hcbClient = createHcbClient();
    for (const grant of sentGrants) {
      if (!grant.hcb_grant_id) continue;
      try {
        await hcbClient.cancelCardGrant(grant.hcb_grant_id);
      } catch (err) {
        const msg =
          (err as { statusMessage?: string; message?: string })?.statusMessage ??
          (err as Error)?.message ??
          "HCB cancel failed";
        try {
          await writeAudit({
            actor_id: actorId,
            action: "revert_ship_approval_failed",
            entity_type: "ship",
            entity_id: String(id),
            old_value: { ship, grant },
            new_value: {
              error: msg,
              hcb_stage: "hcb_refused",
              internal_notes: internalNotes,
            },
            sensitive: true,
            public_message: `HCB refused to cancel grant during ship revert: ${msg}`,
          });
        } catch (auditErr) {
          console.error(
            "Failed to write audit log for revert_ship_approval_failed",
            auditErr,
          );
        }
        throw createError({
          statusCode: 502,
          statusMessage: `HCB refused to cancel grant #${grant.id}: ${msg}`,
        });
      }
    }
  }

  const activeGrantIds = activeGrants.map((grant) => grant.id);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ship.project_id}::bigint)`);

    const restoredPendingCurrencyRows: Array<{
      id: number;
      amount: number;
      fruit_type: string | null;
    }> = [];

    for (const grant of activeGrants) {
      const pattern = `%[converted into grant #${grant.id} on subsequent-grant approval]%`;
      const restored = await tx
        .update(currencyTransactionTable)
        .set({
          counts: true,
          unlocked_at: null,
          memo: sql`COALESCE(${currencyTransactionTable.memo}, '') || ' [restored by ship approval revert]'`,
        })
        .where(
          and(
            eq(currencyTransactionTable.user_id, ship.user_id),
            eq(currencyTransactionTable.pending_for_project_id, ship.project_id),
            eq(currencyTransactionTable.counts, false),
            sql`${currencyTransactionTable.memo} LIKE ${pattern}`,
          ),
        )
        .returning({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          fruit_type: currencyTransactionTable.fruit_type,
        });
      restoredPendingCurrencyRows.push(...restored);
    }

    const disabledCurrencyRows = await tx
      .update(currencyTransactionTable)
      .set({
        counts: false,
        memo: sql`COALESCE(${currencyTransactionTable.memo}, '') || ' [removed by ship approval revert]'`,
      })
      .where(
        and(
          eq(currencyTransactionTable.ship_id, id),
          inArray(currencyTransactionTable.source, ["ship_reward", "review_reward"]),
          eq(currencyTransactionTable.counts, true),
        ),
      )
      .returning({
        id: currencyTransactionTable.id,
        amount: currencyTransactionTable.amount,
        fruit_type: currencyTransactionTable.fruit_type,
      });

    // Undo the approval's lifetime-fruits advance so re-approving can't count it
    // twice. GREATEST(0, ...) so a hand-corrected counter can't go negative.
    const lifetimeFruitDelta = ship.second_pass_lifetime_fruit_delta ?? 0;
    const revertedFruit = ship.second_pass_assigned_fruit;
    const lifetimeFruitDecrement =
      lifetimeFruitDelta > 0 && revertedFruit
        ? { fruit: revertedFruit, amount: lifetimeFruitDelta }
        : null;
    if (lifetimeFruitDecrement) {
      await tx
        .update(users)
        .set({
          lifetime_fruits_earned: sql`
            jsonb_set(
              COALESCE(${users.lifetime_fruits_earned}, '{}'::jsonb),
              ARRAY[${revertedFruit}]::text[],
              to_jsonb(
                GREATEST(
                  0,
                  COALESCE((${users.lifetime_fruits_earned} ->> ${revertedFruit})::numeric, 0)
                  - ${lifetimeFruitDelta}::numeric
                )
              ),
              true
            )
          `,
        })
        .where(eq(users.id, ship.user_id));
    }

    const cancelledGrants = activeGrantIds.length > 0
      ? await tx
          .update(projectGrantTable)
          .set({
            status: "cancelled",
            cancelled_by_user_id: actorId,
            cancelled_at: now,
            cancel_reason: `Ship approval reverted: ${internalNotes}`,
            updated_at: now,
          })
          .where(
            and(
              inArray(projectGrantTable.id, activeGrantIds),
              inArray(projectGrantTable.status, ["queued", "sent"]),
            ),
          )
          .returning()
      : [];

    if (cancelledGrants.length !== activeGrantIds.length) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "A grant for this ship changed before the revert completed. Refresh and try again.",
      });
    }

    // So disabling the rewards above doesn't leave a negative balance.
    const clawback = ship.reviewed_at
      ? await clawBackUntilNonNegative(tx, {
          userId: ship.user_id,
          afterTimestamp: ship.reviewed_at,
          reasonSuffix: `ship #${id} approval reverted`,
        })
      : { disabledTxIds: [], cancelledShopOrderIds: [], hcbGrantOrderIds: [] };

    const [updatedShip] = await tx
      .update(shipTable)
      .set({
        status: "under_review",
        reviewed_at: null,
        decision_audit_notes: null,
        decision_user_message: null,
        decision_user_message_translations: null,
        update_verified_by_reviewer: false,
        // A stale override would silently become the re-review's approved
        // hours. Old values live in the audit row.
        override_hours: null,
        override_reason: null,
        software_override_hours: null,
        software_override_reason: null,
        // Back of the FIFO, so newer submitters' queue positions don't regress.
        queue_entered_at: now,
      })
      .where(
        and(
          eq(shipTable.id, id),
          inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        ),
      )
      .returning();

    if (!updatedShip) {
      throw createError({
        statusCode: 409,
        statusMessage: "Ship status changed before the revert completed.",
      });
    }

    // Restore the next_ship_* drafts the approval consumed; OR/COALESCE so drafts
    // the maker re-entered since the approval win.
    await tx
      .update(projectTable)
      .set({
        next_ship_needs_funding: sql`${projectTable.next_ship_needs_funding} OR ${ship.needs_funding === true}`,
        next_ship_is_build_complete: sql`${projectTable.next_ship_is_build_complete} OR ${ship.is_build_complete_submission === true}`,
        next_ship_is_update: sql`${projectTable.next_ship_is_update} OR ${ship.is_update === true}`,
        next_ship_update_description: sql`COALESCE(${projectTable.next_ship_update_description}, ${ship.update_description})`,
        next_ship_used_ai: sql`${projectTable.next_ship_used_ai} OR ${ship.used_ai === true}`,
        next_ship_ai_usage_description: sql`COALESCE(${projectTable.next_ship_ai_usage_description}, ${ship.ai_usage_description})`,
        next_ship_reviewer_note: sql`COALESCE(${projectTable.next_ship_reviewer_note}, ${ship.reviewer_note})`,
        updated_at: now,
      })
      .where(eq(projectTable.id, ship.project_id));

    return {
      ship: updatedShip,
      cancelledGrants,
      disabledCurrencyRows,
      restoredPendingCurrencyRows,
      clawback,
      lifetimeFruitDecrement,
    };
  });

  await invalidateProject(project.id);

  try {
    await writeAudit({
      actor_id: actorId,
      action: "revert_ship_approval",
      entity_type: "ship",
      entity_id: String(id),
      old_value: {
        ship,
        active_grants: activeGrants,
      },
      new_value: {
        ship: result.ship,
        internal_notes: internalNotes,
        public_notes: publicNotes,
        cancelled_grant_ids: result.cancelledGrants.map((grant) => grant.id),
        disabled_currency_transaction_ids: result.disabledCurrencyRows.map(
          (row) => row.id,
        ),
        restored_pending_currency_transaction_ids:
          result.restoredPendingCurrencyRows.map((row) => row.id),
        claw_back_disabled_currency_transaction_ids:
          result.clawback.disabledTxIds,
        claw_back_cancelled_shop_order_ids:
          result.clawback.cancelledShopOrderIds,
        // Always present: scripts/sweep-revert-phantom-lifetime-fruit.ts skips
        // rows with this key, so it never double-subtracts.
        lifetime_fruit_decrement: result.lifetimeFruitDecrement,
      },
      sensitive: true,
      public_message: publicNotes
        ? `Ship approval reverted: ${publicNotes}`
        : "Ship approval reverted",
      change_summary: project.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for revert_ship_approval", error);
  }

  // After the transaction so HCB calls are outside the project lock. A failure
  // leaves the order intact and flags it for a manual return.
  const hcbGrantRevokeResults: Array<{ orderId: number; revoked: boolean }> = [];
  for (const orderId of result.clawback.hcbGrantOrderIds) {
    try {
      const res = await returnHcbGrantAndRefund(orderId, actorId, {
        reasonLabel: `ship #${id} approval reverted`,
      });
      hcbGrantRevokeResults.push({ orderId, revoked: res.revoked });
    } catch (error) {
      const msg =
        (error as { statusMessage?: string; message?: string })?.statusMessage ??
        (error as Error)?.message ??
        "HCB grant return failed";
      hcbGrantRevokeResults.push({ orderId, revoked: false });
      console.error(
        "[revert-ship] HCB grant auto-return failed for order",
        orderId,
        msg,
      );
      try {
        await writeAudit({
          actor_id: actorId,
          action: "revert_ship_hcb_grant_return_failed",
          entity_type: "shop_order",
          entity_id: String(orderId),
          old_value: { ship_id: id },
          new_value: { error: msg, internal_notes: internalNotes },
          sensitive: true,
          public_message: `Auto-return of HCB grant order #${orderId} failed during ship revert: ${msg}. Return it manually via /internal/orders.`,
          change_summary: project.name,
        });
      } catch (auditErr) {
        console.error(
          "Failed to write audit for revert_ship_hcb_grant_return_failed",
          auditErr,
        );
      }
      void alertHcbGrantNeedsManualReturn({
        shipId: id,
        orderIds: [orderId],
        reason: msg,
      });
    }
  }

  for (const grant of result.cancelledGrants) {
    const oldGrant = activeGrants.find((g) => g.id === grant.id) ?? null;
    try {
      await writeAudit({
        actor_id: actorId,
        action: "cancel_project_grant",
        entity_type: "project_grant",
        entity_id: String(grant.id),
        old_value: oldGrant,
        new_value: grant,
        sensitive: true,
        public_message: "Grant cancelled because ship approval was reverted.",
        change_summary: project.name,
      });
    } catch (error) {
      console.error(
        "Failed to write audit log for grant cancel during ship revert",
        grant.id,
        error,
      );
    }
  }

  const projectUrl = `${publicBaseUrl()}/projects/${project.id}`;
  void notify({
    user_id: ship.user_id,
    type: "ship_decision_reversed",
    title: `${project.name}: approval reverted`,
    body: publicNotes
      ? `Your ship approval was reverted and the project is back under review. Reason: ${publicNotes}`
      : "Your ship approval was reverted and the project is back under review. The Macondo team will review it again.",
    action_url: projectUrl,
    entity_type: "ship",
    entity_id: String(id),
    slack: {
      text: publicNotes
        ? `:arrows_counterclockwise: The approval for *${project.name}* was reverted and the project is back under review.\n>${publicNotes}`
        : `:arrows_counterclockwise: The approval for *${project.name}* was reverted and the project is back under review.`,
    },
    email: {
      template: "ship_decision_reversed",
      data: {
        project_name: project.name,
        previous_status: "approved",
        reason: publicNotes ?? "The Macondo team needs to review it again.",
        project_url: projectUrl,
      },
    },
  });

  return {
    ship: result.ship,
    cancelledGrantCount: result.cancelledGrants.length,
    cancelledSentGrantCount: result.cancelledGrants.filter(
      (grant) =>
        activeGrants.find((g) => g.id === grant.id)?.status === "sent",
    ).length,
    disabledCurrencyTransactionCount: result.disabledCurrencyRows.length,
    restoredPendingCurrencyTransactionCount:
      result.restoredPendingCurrencyRows.length,
    clawBackDisabledCurrencyTransactionCount: result.clawback.disabledTxIds.length,
    clawBackCancelledShopOrderCount: result.clawback.cancelledShopOrderIds.length,
    hcbGrantOrdersRevokedCount: hcbGrantRevokeResults.filter((r) => r.revoked)
      .length,
    hcbGrantOrdersReturnFailedCount: hcbGrantRevokeResults.filter(
      (r) => !r.revoked,
    ).length,
  };
}
