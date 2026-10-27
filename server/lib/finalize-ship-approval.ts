// Runs a second-pass approval's deferred side effects from the frozen reward snapshot, so a
// streak/level change while the ship waited can't alter the payout. Reviewers are not paid gold.

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import db from "../db";
import {
  currencyTransactionTable,
  projectGrantTable,
  projectTable,
  shipContributorsTable,
  shipTable,
  users,
} from "../db/schema";
import { writeAudit } from "./audit";
import { autoQualifyUserForEvent } from "./event-auto-qualify";
import { roundUpHardwareGrantCents } from "./grants";
import { createHcbClient } from "./hcb";
import { syncLoopsEvent, type LoopsEvent } from "./loops";
import { notify } from "./notify";
import { getReviewFlow, shipHasLinkedHackatimeProjects } from "./review";
import { parseLevel } from "./rewards";
import { levelConfig } from "../../app/data/fruitLevels";
import type { AriInboundEvent } from "../types/ari";

type Ship = InferSelectModel<typeof shipTable>;

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

function reviewerSlackAttribution(
  reviewer: { username?: string | null; slack_id?: string | null } | null,
  revealReviewerIdentity: boolean,
): string {
  if (!revealReviewerIdentity || !reviewer) return "";
  return ` by ${reviewer.username ?? "a reviewer"}${reviewer.slack_id ? ` (<@${reviewer.slack_id}>)` : ""}`;
}

// On any HCB error, default to first_card and let the send-time path reconcile from live state.
async function computeIntendedSendAction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: number,
): Promise<"first_card" | "top_up" | "reissue"> {
  const [prior] = await tx
    .select({
      id: projectGrantTable.id,
      hcb_grant_id: projectGrantTable.hcb_grant_id,
    })
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.project_id, projectId),
        eq(projectGrantTable.status, "sent"),
      ),
    )
    .orderBy(sql`${projectGrantTable.sent_at} DESC NULLS LAST`)
    .limit(1);

  if (!prior?.hcb_grant_id) return "first_card";

  try {
    return (await createHcbClient().getCardGrant(prior.hcb_grant_id)).status === "active"
      ? "top_up"
      : "reissue";
  } catch (e) {
    console.error(
      "[finalizeShipApproval] HCB getCardGrant failed; defaulting to first_card",
      e,
    );
    return "first_card";
  }
}

export type FinalizeShipApprovalArgs = {
  shipId: number;
  // Fallback attribution only; the approval is credited to the first-pass reviewer.
  actorId: string;
  // The Airtable sync needs this because ships.ari_last_event is persisted only after consequences succeed.
  ariEvent?: AriInboundEvent | null;
};

export type FinalizeShipApprovalResult =
  | {
      ok: true;
      ship: Ship;
      goldReward: number;
      multiplier: number;
      grantId: number | null;
      finalApprovedHours: number;
      grantQueued: boolean;
      unlockedPendingCount: number;
    }
  | { ok: false; reason: "not_found" | "wrong_status" | "missing_snapshot" };

export async function finalizeShipApproval(
  args: FinalizeShipApprovalArgs,
): Promise<FinalizeShipApprovalResult> {
  const { shipId } = args;

  const [ship] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.id, shipId))
    .limit(1);
  if (!ship) return { ok: false, reason: "not_found" };
  if (ship.status !== "pending_second_pass") {
    return { ok: false, reason: "wrong_status" };
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);
  if (!project) return { ok: false, reason: "not_found" };

  // Frozen reward snapshot from reviewer-approve.
  const reviewerId = ship.first_pass_reviewer_id ?? null;
  const goldReward = ship.second_pass_gold_reward ?? 0;
  const multiplier = ship.second_pass_multiplier ?? 1;
  const lifetimeFruitDelta = ship.second_pass_lifetime_fruit_delta ?? 0;
  const assignedFruit = ship.second_pass_assigned_fruit;
  const splits = ship.second_pass_contributor_split ?? [];
  if (!assignedFruit) {
    // Bail loudly rather than write a half-finished approval.
    console.error("[finalizeShipApproval] missing reward snapshot for ship", shipId);
    return { ok: false, reason: "missing_snapshot" };
  }

  // Deterministic values recomputed from persisted columns (NOT snapshotted).
  const reviewFlow = getReviewFlow(project.type, {
    hasHackatimeProjects: shipHasLinkedHackatimeProjects(ship),
  });
  const shipWantsFunding = ship.needs_funding === true;
  const grantAmountCents = ship.needs_funding_amount_cents ?? 0;
  const finalApprovedHours = ship.override_hours ?? 0;
  const effectiveFundedHours = shipWantsFunding
    ? (ship.needs_funding_hours_override ?? ship.needs_funding_hours ?? 0)
    : 0;
  const fruitEligibleHours = Math.max(0, finalApprovedHours - effectiveFundedHours);
  const level = parseLevel(project.level);
  const goldPerHour = level ? levelConfig[level].goldPerHour : 0;
  // Gold waits on build proof only for funded hardware, since an HCB grant paid for the parts.
  // Self-funded ships have nothing to prove, so their gold pays out on approval.
  const goldIsPending = reviewFlow.hasHardware && shipWantsFunding;

  let reviewerUser: { username: string | null; slack_id: string | null } | null = null;
  if (reviewerId) {
    const [r] = await db
      .select({ username: users.username, slack_id: users.slack_id })
      .from(users)
      .where(eq(users.id, reviewerId))
      .limit(1);
    reviewerUser = r ?? null;
  }
  const reviewerAttribution = reviewerSlackAttribution(
    reviewerUser,
    ship.first_pass_reveal_identity === true,
  );

  const now = new Date();

  const txResult = await db.transaction(async (tx) => {
    // Serializes concurrent finalize/approve on a project so the pending-fruit updates don't cross-pollute.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ship.project_id}::bigint)`);

    // A concurrent finalize (two supaadmins) loses the race and gets no rows.
    const [result] = await tx
      .update(shipTable)
      .set({
        status: "shipped_missing_airtable",
        reviewed_at: now,
        second_pass_actioned_at: now,
      })
      .where(
        sql`${shipTable.id} = ${shipId} AND ${shipTable.status} = 'pending_second_pass'`,
      )
      .returning();

    if (!result) return null;

    let enqueuedGrantId: number | null = null;
    if (shipWantsFunding) {
      const intendedAction = await computeIntendedSendAction(tx, project.id);
      const [grantRow] = await tx
        .insert(projectGrantTable)
        .values({
          project_id: project.id,
          ship_id: ship.id,
          user_id: ship.user_id,
          amount_cents: roundUpHardwareGrantCents(grantAmountCents),
          status: "queued",
          intended_send_action: intendedAction,
        })
        .returning({ id: projectGrantTable.id });
      enqueuedGrantId = grantRow?.id ?? null;
    }

    const memoSplit = shipWantsFunding
      ? `${fruitEligibleHours}h gold of ${finalApprovedHours}h approved (${effectiveFundedHours}h funded)`
      : `${finalApprovedHours}h`;
    // Priority payouts are restricted to priority-eligible items; the memo marker keeps that visible in history.
    const priorityPayout = ship.ari_priority === true;
    const baseMemo = `Ship #${ship.id} approved: ${memoSplit} at level ${level ?? "?"} (${goldPerHour} gold/h) by ${multiplier.toFixed(2)}x project streak bonus${goldIsPending ? " [pending build proof]" : ""}${priorityPayout ? " [priority payout]" : ""} [second pass]`;

    // Replay the frozen split, since ship_contributors may have been edited while the ship waited.
    // approved_hours is written even for zero amounts because every "hours shipped" surface reads it.
    for (const split of splits) {
      await tx
        .update(shipContributorsTable)
        .set({ approved_hours: split.hours, fruit_awarded: Math.max(split.amount, 0) })
        .where(
          and(
            eq(shipContributorsTable.ship_id, ship.id),
            eq(shipContributorsTable.user_id, split.user_id),
          ),
        );

      if (split.amount <= 0) continue;

      const isOwner = split.user_id === ship.user_id;

      await tx.insert(currencyTransactionTable).values({
        user_id: split.user_id,
        amount: split.amount,
        type: "increase",
        source: "ship_reward",
        ship_id: ship.id,
        fruit_type: null,
        memo: `${baseMemo}${isOwner ? "" : ` (group share by hours)`}`,
        counts: true,
        priority: priorityPayout,
        unlocked_at: goldIsPending ? null : now,
        pending_for_project_id: goldIsPending ? project.id : null,
        pending_for_ship_id: goldIsPending ? ship.id : null,
      });

      if (!isOwner) {
        await notify({
          user_id: split.user_id,
          type: "collab_ship_approved",
          title: "Your group project ship was approved",
          body: `You earned ${split.amount} gold from a ship on ${project.name}.`,
          action_url: `/projects/${project.id}`,
          entity_type: "ship",
          entity_id: String(ship.id),
        });
      }
    }

    // Starfruit always lands unlocked, even for hardware.
    if (ship.extra_fruity === true) {
      await tx.insert(currencyTransactionTable).values({
        user_id: ship.user_id,
        amount: 1,
        type: "increase",
        source: "extra_fruity_reward",
        ship_id: ship.id,
        fruit_type: "starfruit",
        memo: `Extra fruity ship #${ship.id}: +1 starfruit`,
        counts: true,
        unlocked_at: now,
      });
    }

    if (lifetimeFruitDelta > 0) {
      await tx
        .update(users)
        .set({
          lifetime_fruits_earned: sql`
            jsonb_set(
              COALESCE(${users.lifetime_fruits_earned}, '{}'::jsonb),
              ARRAY[${assignedFruit}]::text[],
              to_jsonb(
                COALESCE((${users.lifetime_fruits_earned} ->> ${assignedFruit})::numeric, 0)
                + ${lifetimeFruitDelta}::numeric
              ),
              true
            )
          `,
        })
        .where(eq(users.id, ship.user_id));
    }

    // A funded ship converts the project's earlier pending gold into the grant (the user took parts money).
    let forfeitedFruitRows: Array<{ id: number; amount: number; fruit_type: string | null }> = [];
    if (shipWantsFunding && enqueuedGrantId != null) {
      forfeitedFruitRows = await tx
        .update(currencyTransactionTable)
        .set({
          unlocked_at: now,
          counts: false,
          memo: sql`${currencyTransactionTable.memo} || ' [converted into grant #' || ${enqueuedGrantId} || ' on subsequent-grant approval]'`,
        })
        .where(
          and(
            eq(currencyTransactionTable.pending_for_project_id, ship.project_id),
            eq(currencyTransactionTable.user_id, ship.user_id),
            isNull(currencyTransactionTable.unlocked_at),
            ne(currencyTransactionTable.ship_id, ship.id),
          ),
        )
        .returning({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          fruit_type: currencyTransactionTable.fruit_type,
        });
    }

    // No user_id filter: collaborators' pending rows carry their own user_id.
    // Filtering on counts means a reversed row is never resurrected.
    let unlockedRows: Array<{
      id: number;
      amount: number;
      fruit_type: string | null;
      user_id: string;
    }> = [];
    if (ship.is_build_complete_submission === true && reviewFlow.hasHardware) {
      unlockedRows = await tx
        .update(currencyTransactionTable)
        .set({ unlocked_at: now })
        .where(
          and(
            eq(currencyTransactionTable.pending_for_project_id, ship.project_id),
            isNull(currencyTransactionTable.unlocked_at),
            eq(currencyTransactionTable.counts, true),
          ),
        )
        .returning({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          fruit_type: currencyTransactionTable.fruit_type,
          user_id: currencyTransactionTable.user_id,
        });
    }

    // The draft reset belongs here, not at reviewer-approve, so a supaadmin request-changes doesn't wipe it.
    await tx
      .update(projectTable)
      .set({
        fruit: assignedFruit,
        updated_at: now,
        next_ship_needs_funding: false,
        next_ship_is_build_complete: false,
        next_ship_is_update: false,
        next_ship_update_description: null,
        next_ship_used_ai: false,
        next_ship_ai_usage_description: null,
        next_ship_reviewer_note: null,
      })
      .where(eq(projectTable.id, ship.project_id));

    return { result, enqueuedGrantId, unlockedRows, forfeitedFruitRows };
  });

  if (!txResult) return { ok: false, reason: "wrong_status" };

  const { result: updatedShipRow, enqueuedGrantId, unlockedRows, forfeitedFruitRows } =
    txResult;

  // The leaderboard counts 'approve_ship', so credit the first-pass reviewer.
  const approvalActorId = reviewerId ?? args.actorId;

  try {
    const grantPart = shipWantsFunding
      ? `$${(grantAmountCents / 100).toFixed(2)} grant queued`
      : "";
    const goldPart = goldReward > 0 ? `${goldReward} gold awarded` : "";
    const forfeitedTotal = forfeitedFruitRows.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0,
    );
    const forfeitPart = forfeitedFruitRows.length > 0
      ? `${forfeitedTotal} pending gold converted into grant`
      : "";
    const rewardParts = [grantPart, goldPart, forfeitPart].filter(Boolean).join(" + ");
    await writeAudit({
      actor_id: approvalActorId,
      action: "approve_ship",
      entity_type: "ship",
      entity_id: String(shipId),
      old_value: ship,
      new_value: updatedShipRow,
      sensitive: false,
      // Neutral wording: finalize also runs for a supaadmin's direct approval, which skips second pass.
      public_message: `Ship approved: ${finalApprovedHours}h, ${rewardParts || "no reward"}`,
      change_summary: project.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for ship approval", error);
  }

  if (shipWantsFunding && enqueuedGrantId != null) {
    try {
      await writeAudit({
        actor_id: approvalActorId,
        action: "enqueue_project_grant",
        entity_type: "project_grant",
        entity_id: String(enqueuedGrantId),
        old_value: null,
        new_value: {
          project_id: project.id,
          ship_id: ship.id,
          user_id: ship.user_id,
          amount_cents: grantAmountCents,
          status: "queued",
        },
        sensitive: true,
        public_message: `Grant #${enqueuedGrantId} enqueued: $${(grantAmountCents / 100).toFixed(2)} for ${project.name}`,
        change_summary: project.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for grant enqueue", enqueuedGrantId, error);
    }
  }

  // Every approved ship syncs, hardware designs included. syncShipToAirtable owns the move to 'shipped';
  // on failure the ship stays in shipped_missing_airtable for the repair cron.
  try {
    const { syncShipToAirtable } = await import("./airtable");
    void syncShipToAirtable(shipId, {
      reviewerUserId: approvalActorId,
      ariEvent: args.ariEvent ?? null,
    }).catch((error: unknown) => {
      console.error("Airtable sync failed for ship", shipId, error);
    });
  } catch (error) {
    // Leave it for the repair cron rather than falsely promoting it to shipped.
    console.error("Airtable module load failed for ship", shipId, error);
  }

  let contributorIds: string[] = [];
  try {
    contributorIds = (
      await db
        .select({ user_id: shipContributorsTable.user_id })
        .from(shipContributorsTable)
        .where(eq(shipContributorsTable.ship_id, ship.id))
    ).map((r) => r.user_id);
    if (!contributorIds.includes(ship.user_id)) contributorIds.push(ship.user_id);
  } catch (error) {
    console.error("Contributor lookup failed for ship approval", shipId, error);
  }

  // Milestones use each member's own slice sum, never ship.override_hours (the team total under the owner).
  try {
    for (const contributorId of contributorIds) {
      const [person] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          slack_id: users.slack_id,
        })
        .from(users)
        .where(eq(users.id, contributorId))
        .limit(1);
      if (!person?.email) continue;

      const [hoursRow] = await db
        .select({
          hours: sql<number>`COALESCE(SUM(COALESCE(${shipContributorsTable.approved_hours}, 0)), 0)`,
        })
        .from(shipContributorsTable)
        .innerJoin(shipTable, eq(shipTable.id, shipContributorsTable.ship_id))
        .where(
          and(
            eq(shipContributorsTable.user_id, contributorId),
            inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
          ),
        );
      const totalHours = Number(hoursRow?.hours ?? 0);

      const firstName = person.name?.trim().split(/\s+/)[0] ?? null;
      const lastName = person.name?.trim().split(/\s+/).slice(1).join(" ") || null;

      const eventsToFire: LoopsEvent[] = ["macondoFirstProjectShipped"];
      if (totalHours >= 1) eventsToFire.push("macondoOneHour");
      if (totalHours >= 5) eventsToFire.push("macondoFiveHours");
      if (totalHours >= 10) eventsToFire.push("macondoTenHours");
      if (totalHours >= 20) eventsToFire.push("macondoTwentyHours");

      for (const evt of eventsToFire) {
        void syncLoopsEvent({
          email: person.email,
          slack_id: person.slack_id ?? null,
          first_name: firstName,
          last_name: lastName,
          event: evt,
          user_id: person.id,
        });
      }
    }
  } catch (error) {
    console.error("Loops sync failed for ship approval", shipId, error);
  }

  // Fire-and-forget so it never delays or fails the approval.
  for (const contributorId of contributorIds) {
    void autoQualifyUserForEvent(contributorId).catch((error: unknown) => {
      console.error("Event auto-qualify failed", contributorId, error);
    });
  }

  const projectUrl = `${publicBaseUrl()}/projects/${project.id}`;
  const grantSummary = shipWantsFunding
    ? `$${(grantAmountCents / 100).toFixed(2)} grant queued for payout`
    : "";
  const goldSummary = goldReward > 0 ? `${goldReward} gold earned` : "";
  const forfeitedTotalForUi = forfeitedFruitRows.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );
  const forfeitSummary = forfeitedFruitRows.length > 0
    ? `${forfeitedTotalForUi} pending gold converted into the grant`
    : "";
  const rewardSummary = [grantSummary, goldSummary, forfeitSummary].filter(Boolean).join(" + ") || "no reward";
  const streakNote = multiplier > 1 ? ` (with a ${multiplier.toFixed(2)}x streak bonus)` : "";
  // A funded ship is never build-complete (exclusive at submit), so the claim guidance always applies.
  const goldPendingNote = goldIsPending
    ? " (pending — submit a build-complete ship to claim)"
    : "";
  const notifyBody = shipWantsFunding
    ? (goldReward > 0
        ? `Your ship was approved. A $${(grantAmountCents / 100).toFixed(2)} grant has been queued, and you earned ${goldReward} gold for the ${fruitEligibleHours}h beyond your funded work${streakNote}${goldPendingNote}.`
        : `Your ship was approved. A $${(grantAmountCents / 100).toFixed(2)} grant has been queued for payout.`)
    : `Your ship was approved. You earned ${goldReward} gold at ${finalApprovedHours}h${streakNote}${goldPendingNote}.`;
  void notify({
    user_id: ship.user_id,
    type: "ship_approved",
    title: `${project.name} approved!`,
    body: notifyBody,
    action_url: projectUrl,
    entity_type: "ship",
    entity_id: String(shipId),
    slack: {
      text: `:white_check_mark: *${project.name}* approved${reviewerAttribution}! ${rewardSummary}.`,
    },
    email: {
      template: "ship_approved",
      data: {
        project_name: project.name,
        hours: finalApprovedHours,
        reward_summary: rewardSummary,
        project_url: projectUrl,
      },
    },
  });

  if (ship.extra_fruity === true) {
    void notify({
      user_id: ship.user_id,
      type: "ship_extra_fruity",
      title: `Your ship for ${project.name} is extra fruity`,
      body: "A reviewer marked this specific ship as extra fruity for an exceptional build. You earned 1 starfruit, and this ship now carries the Extra Fruity badge.",
      action_url: projectUrl,
      entity_type: "ship",
      entity_id: String(shipId),
      slack: {
        text: `:tada: Your ship for *${project.name}* (ship #${shipId}) was marked extra fruity! +1 starfruit.`,
      },
    });
  }

  if (unlockedRows.length > 0) {
    // Each contributor is DMed their own unlocked amount, not the owner with the total.
    const unlockedByUser = new Map<string, number>();
    for (const row of unlockedRows) {
      unlockedByUser.set(
        row.user_id,
        (unlockedByUser.get(row.user_id) ?? 0) + Number(row.amount ?? 0),
      );
    }
    const totalUnlocked = [...unlockedByUser.values()].reduce(
      (sum, amt) => sum + amt,
      0,
    );
    const unlockedSummary = `${totalUnlocked} gold`;
    for (const [unlockUserId, amount] of unlockedByUser) {
      void notify({
        user_id: unlockUserId,
        type: "pending_fruit_unlocked",
        title: `Pending gold unlocked for ${project.name}`,
        body: `Build confirmed! You just unlocked ${amount} gold that was waiting on this project's build proof.`,
        action_url: projectUrl,
        entity_type: "project",
        entity_id: String(project.id),
        slack: {
          text: `:unlock: *${project.name}* build confirmed${reviewerAttribution}. ${amount} gold unlocked.`,
        },
      });
    }

    try {
      await writeAudit({
        actor_id: approvalActorId,
        action: "unlock_pending_fruit",
        entity_type: "fruit_unlock_batch",
        entity_id: String(project.id),
        old_value: null,
        new_value: {
          project_id: project.id,
          ship_id: ship.id,
          unlocked_tx_ids: unlockedRows.map((r) => r.id),
          total_gold: totalUnlocked,
        },
        sensitive: false,
        public_message: `Unlocked ${unlockedSummary} pending for ${project.name}`,
        change_summary: project.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for pending unlock batch", error);
    }
  }

  return {
    ok: true,
    ship: updatedShipRow,
    goldReward,
    multiplier,
    grantId: enqueuedGrantId,
    finalApprovedHours,
    grantQueued: shipWantsFunding,
    unlockedPendingCount: unlockedRows.length,
  };
}
