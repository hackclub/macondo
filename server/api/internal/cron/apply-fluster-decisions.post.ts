// Applies Fluster's wrap-up review decisions to ships, through the same chain ARI uses:
// approve = buildApproveSnapshot + finalizeShipApproval (gold, grants, notifications, Airtable),
// reject = markShipRejected. Dry run unless the body says `dryRun: false`.
// Sent by fluster's scripts/macondo-payout.ts.

import { eq } from "drizzle-orm";

import db from "../../../db";
import { projectTable, shipTable, users } from "../../../db/schema";
import { splitGoldByHours } from "../../../lib/contributor-hours-split";
import { isValidCronToken } from "../../../lib/cron-token";
import { finalizeShipApproval } from "../../../lib/finalize-ship-approval";
import {
  getApprovedJournalHoursForShip,
  getReviewFlow,
  shipHasLinkedHackatimeProjects,
} from "../../../lib/review";
import { markShipRejected } from "../../../lib/review-actions";
import {
  computeFundedHoursFromGrant,
  computeGoldReward,
  parseLevel,
} from "../../../lib/rewards";
import { buildApproveSnapshot } from "../../../lib/ship-approve-snapshot";
import { getContributorClaimedHours } from "../../../lib/ship-hours";
import { effectiveStreakDaysForShip, projectMultiplierForRun } from "../../../lib/streaks";
import { hasRole } from "../../../policies/internal";

type Decision =
  | { shipId: number; action: "approve"; hours: number; reviewer: string | null }
  | { shipId: number; action: "reject"; reason: string | null; reviewer: string | null };

type Outcome = {
  shipId: number;
  action: Decision["action"];
  ok: boolean;
  note: string;
  hours?: number;
  gold?: number;
  // Group ships only: what each contributor gets.
  split?: Array<{ user_id: string; amount: number }>;
};

const MAX_DECISIONS = 50;

const parseDecision = (raw: unknown): Decision | null => {
  const d = raw as Record<string, unknown> | null;
  if (!d || !Number.isInteger(d.shipId) || (d.shipId as number) <= 0) return null;
  const reviewer = typeof d.reviewer === "string" ? d.reviewer : null;
  if (d.action === "approve") {
    const hours = Number(d.hours);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return { shipId: d.shipId as number, action: "approve", hours, reviewer };
  }
  if (d.action === "reject") {
    return {
      shipId: d.shipId as number,
      action: "reject",
      reason: typeof d.reason === "string" ? d.reason : null,
      reviewer,
    };
  }
  return null;
};

const auditNotes = (decision: Decision) =>
  [
    `Fluster wrap-up review${decision.reviewer ? ` by ${decision.reviewer}` : ""}.`,
    decision.action === "reject" && decision.reason ? `Flagged: ${decision.reason}` : null,
  ]
    .filter(Boolean)
    .join("\n");

export default defineEventHandler(async (event) => {
  const sessionUser = event.context.user as (typeof users.$inferSelect) | null | undefined;
  const cronAllowed = isValidCronToken(event);
  const userAllowed = sessionUser != null && hasRole(sessionUser, ["supaadmin", "admin"]);
  if (!cronAllowed && !userAllowed) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{
    decisions?: unknown[];
    dryRun?: boolean;
    actorId?: string;
    rejectMessage?: string | null;
    approveMessage?: string | null;
  } | null>(event).catch(() => null);
  const dryRun = body?.dryRun !== false;
  const raw: unknown[] = Array.isArray(body?.decisions) ? body!.decisions! : [];
  if (!raw.length || raw.length > MAX_DECISIONS) {
    throw createError({ statusCode: 400, statusMessage: `Send 1-${MAX_DECISIONS} decisions per request` });
  }
  const decisions = raw.map(parseDecision);
  if (decisions.some((d) => d === null)) {
    throw createError({ statusCode: 400, statusMessage: "Malformed decision" });
  }

  // audit_logs.actor_id is NOT NULL: the admin behind the run, from the session or (cron) the body.
  const actorId = sessionUser?.id ?? body?.actorId;
  if (!actorId) throw createError({ statusCode: 400, statusMessage: "actorId is required" });
  const [actor] = await db.select({ id: users.id, roles: users.roles }).from(users).where(eq(users.id, actorId)).limit(1);
  if (!actor || !hasRole(actor as typeof users.$inferSelect, ["supaadmin", "admin"])) {
    throw createError({ statusCode: 400, statusMessage: "actorId must be an admin" });
  }
  const rejectMessage = body?.rejectMessage?.trim() || null;
  // Shown to the student as "Reviewer notes" on the project timeline.
  const approveMessage = body?.approveMessage?.trim() || null;

  // Sequential on purpose: finalize talks to HCB and Airtable (5 rps per base).
  const results: Outcome[] = [];
  for (const decision of decisions as Decision[]) {
    const done = (ok: boolean, note: string, extra: Partial<Outcome> = {}) =>
      results.push({ shipId: decision.shipId, action: decision.action, ok, note, ...extra });

    const [ship] = await db.select().from(shipTable).where(eq(shipTable.id, decision.shipId)).limit(1);
    if (!ship) { done(false, "ship_not_found"); continue; }
    // Fluster only ever imported ships waiting for review; anything else was decided in Macondo since.
    if (ship.status !== "under_review") { done(false, `status_is_${ship.status}`); continue; }
    const [project] = await db.select().from(projectTable).where(eq(projectTable.id, ship.project_id)).limit(1);
    if (!project) { done(false, "project_missing"); continue; }
    if (project.deleted_at) { done(false, "project_deleted"); continue; }

    if (decision.action === "reject") {
      if (dryRun) { done(true, "would_reject"); continue; }
      const result = await markShipRejected({
        shipId: ship.id,
        shipBefore: ship,
        projectId: project.id,
        projectName: project.name,
        notifyUserId: ship.user_id,
        actorId,
        auditNotes: auditNotes(decision),
        // The flag reason is a reviewer's internal note; the student sees rejectMessage (or the default).
        userMessage: rejectMessage,
        decisionAttachments: null,
        slackAttribution: "",
        source: "reviewer",
      });
      done(result.ok, result.ok ? "rejected" : result.reason);
      continue;
    }

    const hours = decision.hours;
    const level = parseLevel(project.level);
    if (!level) { done(false, "project_has_no_level", { hours }); continue; }

    // Fluster reviews a ship as one project, so a group ship's gold is split by what each member claims.
    // Without this the split falls back to the submit-time snapshot, which only has the owner's hours.
    const claimed = await getContributorClaimedHours(ship);
    if (!claimed.ok) { done(false, "collaborator_hours_unreadable", { hours }); continue; }
    const amounts = (split: Array<{ user_id: string; amount: number }>) =>
      split.map(({ user_id, amount }) => ({ user_id, amount }));

    if (dryRun) {
      // Mirrors buildApproveSnapshot's gold math, for the preview only.
      const fundedHours = ship.needs_funding === true
        ? computeFundedHoursFromGrant(ship.needs_funding_amount_cents ?? 0, level)
        : 0;
      if (ship.needs_funding === true && (ship.needs_funding_amount_cents ?? 0) <= 0) {
        done(false, "funded_ship_with_zero_build_cost", { hours });
        continue;
      }
      const multiplier = projectMultiplierForRun({
        projectStreakDays: effectiveStreakDaysForShip({
          snapshot: ship.project_streak_days_at_submission,
          liveStreakDays: project.project_streak_days ?? 0,
        }),
        lastWorkedDate: project.last_worked_date,
        level,
      });
      const gold = Math.floor(computeGoldReward(Math.max(0, hours - fundedHours), level) * multiplier);
      done(true, "would_approve", {
        hours,
        gold,
        ...(claimed.hours
          ? {
              split: amounts(
                splitGoldByHours(
                  claimed.hours.map((c) => ({ user_id: c.user_id, hours: c.approved_hours })),
                  gold,
                  hours,
                  ship.user_id,
                ),
              ),
            }
          : {}),
      });
      continue;
    }

    // Same software split as the ARI path: journals keep their hours, the rest is the software override.
    const softwareOverride = getReviewFlow(project.type, {
      hasHackatimeProjects: shipHasLinkedHackatimeProjects(ship),
    }).hasSoftware
      ? Math.max(0, hours - (await getApprovedJournalHoursForShip(ship.id)))
      : undefined;

    const snapshot = await buildApproveSnapshot({
      ship,
      project,
      finalApprovedHours: hours,
      actorId,
      auditNotes: auditNotes(decision),
      userMessage: approveMessage,
      decisionAttachments: null,
      revealReviewerIdentity: false,
      extraFruity: false,
      contributorHours: claimed.hours,
      fromStatuses: ["under_review"],
      extraSet: softwareOverride !== undefined ? { software_override_hours: softwareOverride } : undefined,
    });
    if (!snapshot.ok) {
      done(false, snapshot.statusCode === 409 ? "decision_conflict" : `snapshot_invalid: ${snapshot.message}`, { hours });
      continue;
    }

    const finalized = await finalizeShipApproval({ shipId: ship.id, actorId });
    if (!finalized.ok) {
      done(false, `parked_pending_second_pass: ${finalized.reason}`, { hours, gold: snapshot.goldReward });
      continue;
    }
    done(true, "approved", {
      hours: finalized.finalApprovedHours,
      gold: finalized.goldReward,
      ...(claimed.hours ? { split: amounts(snapshot.ship.second_pass_contributor_split ?? []) } : {}),
    });
  }

  // The messages this deploy applied, so the caller can tell an older deploy (which drops them) apart.
  return { dryRun, count: results.length, results, messages: { approve: approveMessage, reject: rejectMessage } };
});
