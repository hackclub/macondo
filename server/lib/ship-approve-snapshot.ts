// Shared by the reviewer and ARI approve paths so the money math lives in one place.
// Only freezes the snapshot; finalize-ship-approval.ts moves currency later.

import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";

import db from "../db";
import { projectTable, shipContributorsTable, shipTable } from "../db/schema";
import { splitGoldByHours } from "./contributor-hours-split";
import {
  computeFruitReward,
  computeFundedHoursFromGrant,
  computeGoldReward,
  parseLevel,
} from "./rewards";
import { effectiveStreakDaysForShip, projectMultiplierForRun } from "./streaks";
import { getFruitsByLevelAndCategory } from "../../app/data/fruitLevels";

type Ship = InferSelectModel<typeof shipTable>;
type Project = InferSelectModel<typeof projectTable>;

export type ApproveSnapshotFromStatus =
  | "under_review"
  | "pending_fraud_review"
  | "pending_second_pass";

export interface BuildApproveSnapshotArgs {
  ship: Ship;
  project: Project;
  finalApprovedHours: number;
  // Null on the ARI path when the reviewer has no Macondo account; finalize then uses its own actor.
  actorId: string | null;
  auditNotes: string | null;
  userMessage: string | null;
  decisionAttachments: Array<{
    url: string;
    filename: string;
    mime_type: string;
    sha: string;
  }> | null;
  revealReviewerIdentity: boolean;
  extraFruity: boolean;
  // Validated here so every caller shares the same rules and error messages.
  needsFundingHoursOverride?: number | null;
  // Layered on the hackatime snapshot; entries for unknown contributors are ignored.
  contributorHours?: Array<{ user_id: string; approved_hours: number }> | null;
  // Locks the payout to priority-eligible shop items. Written on every park so a re-approval clears a stale true.
  priorityPayout?: boolean;
  // The ARI path adds pending_second_pass so an organizer-confirmed approval supersedes a parked first pass.
  fromStatuses?: ApproveSnapshotFromStatus[];
  // Persisted atomically with the snapshot (e.g. the ARI mirror state).
  extraSet?: Partial<Ship>;
}

export type BuildApproveSnapshotResult =
  | {
      ok: true;
      ship: Ship;
      goldReward: number;
      baseGoldReward: number;
      multiplier: number;
      finalApprovedHours: number;
      shipWantsFunding: boolean;
    }
  | { ok: false; statusCode: 400; message: string }
  | { ok: false; statusCode: 409; code: "write_conflict" };

export async function buildApproveSnapshot(
  args: BuildApproveSnapshotArgs,
): Promise<BuildApproveSnapshotResult> {
  const { ship, project, finalApprovedHours, actorId } = args;

  const level = parseLevel(project.level);
  if (!level) {
    return {
      ok: false,
      statusCode: 400,
      message: "Project has no valid level assigned. Cannot compute reward.",
    };
  }

  const shipWantsFunding = ship.needs_funding === true;
  // Hours the parts grant already paid for; gold is paid only above this. Also the ceiling for any override.
  const derivedFundedHours = shipWantsFunding
    ? computeFundedHoursFromGrant(ship.needs_funding_amount_cents ?? 0, level)
    : 0;
  const rawReviewerOverride = args.needsFundingHoursOverride;
  let reviewerFundingHoursOverride: number | null = null;
  if (shipWantsFunding && rawReviewerOverride !== undefined && rawReviewerOverride !== null) {
    const parsed = Number(rawReviewerOverride);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        statusCode: 400,
        message: "Funded-hours override must be a non-negative number.",
      };
    }
    // Clamp down to the grant-derived hours, never up: over-claiming funded hours zeroes out earned gold.
    reviewerFundingHoursOverride = Math.round(
      Math.min(parsed, derivedFundedHours),
    );
  }
  const fruitEligibleHours = Math.max(
    0,
    finalApprovedHours -
      (shipWantsFunding ? (reviewerFundingHoursOverride ?? derivedFundedHours) : 0),
  );

  // Pre-multiplier rewards; fruit only advances the lifetime_fruits_earned stat, it's no longer currency.
  const baseGoldReward = computeGoldReward(fruitEligibleHours, level);
  const baseFruitReward = computeFruitReward(fruitEligibleHours, level);
  const now = new Date();
  // Derive from the current level: project.fruit is stale if a reviewer changed the level.
  const assignedFruit = getFruitsByLevelAndCategory(
    level,
    project.type === "hardware" || project.type === "software" ? project.type : "software",
  )[0]?.name;

  if (!assignedFruit) {
    return {
      ok: false,
      statusCode: 400,
      message: "Project has no fruit available for its level and type.",
    };
  }

  const grantAmountCents = ship.needs_funding_amount_cents ?? 0;
  if (shipWantsFunding && grantAmountCents <= 0) {
    return {
      ok: false,
      statusCode: 400,
      message:
        "Cannot approve a funded hardware ship with a $0 build cost. Ask the user to resubmit after setting a valid build cost.",
    };
  }

  // Freeze gold now so review latency or a level edit can't change it; the streak is max(snapshot, live).
  const [streakRow] = await db
    .select({ project_streak_days: projectTable.project_streak_days })
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);
  const streakDays = effectiveStreakDaysForShip({
    snapshot: ship.project_streak_days_at_submission,
    liveStreakDays: streakRow?.project_streak_days ?? 0,
  });
  const multiplier = projectMultiplierForRun({
    projectStreakDays: streakDays,
    lastWorkedDate: project.last_worked_date,
    level,
  });
  // Round gold to a whole coin for ledger consistency.
  const goldReward = Math.floor(baseGoldReward * multiplier);

  // Frozen so contributor edits during the wait can't change the split. Computed even when goldReward
  // is 0, because the per-contributor hours still feed ship_contributors.approved_hours.
  const contributorRows = await db
    .select()
    .from(shipContributorsTable)
    .where(eq(shipContributorsTable.ship_id, ship.id));

  const suggested = new Map<string, number>(
    contributorRows.map((r) => [r.user_id, Number(r.hackatime_hours ?? 0)]),
  );
  if (Array.isArray(args.contributorHours)) {
    for (const override of args.contributorHours) {
      if (
        typeof override?.user_id === "string" &&
        typeof override.approved_hours === "number" &&
        Number.isFinite(override.approved_hours) &&
        override.approved_hours >= 0 &&
        suggested.has(override.user_id)
      ) {
        suggested.set(override.user_id, override.approved_hours);
      }
    }
  }
  const contributorSplit = splitGoldByHours(
    contributorRows.map((r) => ({ user_id: r.user_id, hours: suggested.get(r.user_id) ?? 0 })),
    goldReward,
    finalApprovedHours,
    ship.user_id,
  );

  // Status-guarded so a concurrent action loses the race. reviewed_at stays NULL until finalize.
  const [result] = await db
    .update(shipTable)
    .set({
      status: "pending_second_pass",
      decision_audit_notes: args.auditNotes,
      decision_user_message: args.userMessage,
      decision_user_message_attachments: args.decisionAttachments,
      override_hours: finalApprovedHours,
      needs_funding_hours: shipWantsFunding ? derivedFundedHours : null,
      needs_funding_hours_override: reviewerFundingHoursOverride,
      extra_fruity: args.extraFruity,
      first_pass_reviewer_id: actorId,
      first_pass_approved_at: now,
      first_pass_reveal_identity: args.revealReviewerIdentity,
      second_pass_gold_reward: goldReward,
      second_pass_multiplier: multiplier,
      // Only advances users.lifetime_fruits_earned at finalize.
      second_pass_lifetime_fruit_delta: Math.floor(baseFruitReward * multiplier),
      second_pass_assigned_fruit: assignedFruit,
      second_pass_contributor_split: contributorSplit,
      ari_priority: args.priorityPayout === true,
      ...(args.extraSet ?? {}),
    })
    .where(
      and(
        eq(shipTable.id, ship.id),
        inArray(
          shipTable.status,
          args.fromStatuses ?? ["under_review", "pending_fraud_review"],
        ),
      ),
    )
    .returning();

  if (!result) {
    return { ok: false, statusCode: 409, code: "write_conflict" };
  }

  return {
    ok: true,
    ship: result,
    goldReward,
    baseGoldReward,
    multiplier,
    finalApprovedHours,
    shipWantsFunding,
  };
}
