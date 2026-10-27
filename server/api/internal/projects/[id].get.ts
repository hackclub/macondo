import { and, desc, eq, isNull, sql } from "drizzle-orm";

import db from "../../../db";
import {
  auditLogTable,
  currencyTransactionTable,
  dailyProjectActivityTable,
  journalsTable,
  projectTable,
  shipTable,
  users,
} from "../../../db/schema";
import {
  airtableRecordUrl,
  getAirtableRecordHealthBatch,
} from "../../../lib/airtable";
import {
  getDevDebugFlags,
  getEffectiveHackatimeOAuthToken,
} from "../../../lib/dev-debug-flags";
import { getAuthenticatedProjects } from "../../../lib/hackatime";
import { notifySelfProjectAccess } from "../../../lib/self-project-access-alert";
import {
  canFulfillPendingGold,
  canReviewOwnProjects,
  isAbleToHandlePII,
  redactProjectForInternal,
} from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const devDebugFlags = getDevDebugFlags(event);
  const id = Number(getRouterParam(event, "id"));

  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, id))
    .limit(1);

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  if (
    project.user_id === actor.id &&
    !canReviewOwnProjects(actor) &&
    !devDebugFlags.ignoreReviewerOwnershipPolicies
  ) {
    await notifySelfProjectAccess({
      actor,
      projectId: project.id,
      projectName: project.name ?? `Project #${project.id}`,
      projectUserId: project.user_id,
      source: "internal_projects",
      blocked: true,
    });

    throw createError({
      statusCode: 403,
      statusMessage: "You cannot open your own project in the internal dashboard",
    });
  }

  const [owner, ships, journals, journalCount, audits, activityTotals, pendingGold] = await Promise.all([
    project.user_id
      ? db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
            slack_id: users.slack_id,
            username: users.username,
            hackatime_id: users.hackatime_id,
          })
          .from(users)
          .where(eq(users.id, project.user_id))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        id: shipTable.id,
        status: shipTable.status,
        hackatime_hours: shipTable.hackatime_hours,
        override_hours: shipTable.override_hours,
        override_reason: shipTable.override_reason,
        created_at: shipTable.created_at,
        reviewed_at: shipTable.reviewed_at,
        assigned_user_id: shipTable.assigned_user_id,
        airtable_record_id: shipTable.airtable_record_id,
      })
      .from(shipTable)
      .where(eq(shipTable.project_id, id))
      .orderBy(desc(shipTable.created_at)),
    db
      .select({
        id: journalsTable.id,
        short_brief: journalsTable.short_brief,
        long_brief: journalsTable.long_brief,
        hours: journalsTable.hours,
        created_at: journalsTable.created_at,
        approved: journalsTable.approved,
        reviewed: journalsTable.reviewed,
        reviewed_at: journalsTable.reviewed_at,
        reviewed_by: journalsTable.reviewed_by,
        decision_justification: journalsTable.decision_justification,
        override_hours: journalsTable.override_hours,
        override_justification: journalsTable.override_justification,
        archived: journalsTable.archived,
        archived_at: journalsTable.archived_at,
        archived_by: journalsTable.archived_by,
      })
      .from(journalsTable)
      .where(eq(journalsTable.project_id, id))
      .orderBy(desc(journalsTable.created_at), desc(journalsTable.id)),
    db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(journalsTable)
      .where(eq(journalsTable.project_id, id))
      .then((rows) => rows[0]?.count ?? 0),
    db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        entity_id: auditLogTable.entity_id,
        old_value: auditLogTable.old_value,
        new_value: auditLogTable.new_value,
        public_message: auditLogTable.public_message,
        change_summary: auditLogTable.change_summary,
        created_at: auditLogTable.created_at,
        actor: {
          id: users.id,
          name: users.name,
          image: users.image,
          username: users.username,
        },
      })
      .from(auditLogTable)
      .leftJoin(
        users,
        and(
          eq(auditLogTable.actor_id, users.id),
          eq(auditLogTable.entity_type, "project"),
        ),
      )
      .where(
        and(
          eq(auditLogTable.entity_type, "project"),
          eq(auditLogTable.entity_id, String(id)),
        ),
      )
      .orderBy(desc(auditLogTable.created_at)),
    // live totals ship snapshots don't capture; hackatime_seconds uses the earliest-claim dedupe (daily-activity.ts)
    db
      .select({
        journal_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds}), 0)`.mapWith(Number),
        hackatime_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.hackatime_seconds}), 0)`.mapWith(Number),
      })
      .from(dailyProjectActivityTable)
      .where(eq(dailyProjectActivityTable.project_id, id))
      .then((rows) => rows[0] ?? { journal_seconds: 0, hackatime_seconds: 0 }),
    // counts=true drops reversed rows; the CASE keeps the sum right if a pending row is a decrease
    db
      .select({
        total: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`.mapWith(Number),
        row_count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.pending_for_project_id, id),
          isNull(currencyTransactionTable.unlocked_at),
          eq(currencyTransactionTable.counts, true),
        ),
      )
      .then((rows) => rows[0] ?? { total: 0, row_count: 0 }),
  ]);

  const showPii = isAbleToHandlePII(actor);

  // failures are swallowed so a Hackatime outage doesn't block the admin page
  const hackatimeProjectStats: Array<{ name: string; total_seconds: number }> = [];
  const linkedNames = project.hackatime_projects ?? [];
  if (linkedNames.length > 0 && project.user_id) {
    try {
      const [ownerToken] = await db
        .select({ token: users.hackatime_oauth_token })
        .from(users)
        .where(eq(users.id, project.user_id))
        .limit(1);
      const token =
        project.user_id === actor.id
          ? getEffectiveHackatimeOAuthToken(event, ownerToken?.token ?? null)
          : ownerToken?.token ?? null;
      if (token) {
        const resp = await getAuthenticatedProjects(token, {
          includeArchived: true,
        });
        const linkedSet = new Set(linkedNames);
        for (const p of resp?.projects ?? []) {
          if (linkedSet.has(p.name)) {
            hackatimeProjectStats.push({
              name: p.name,
              total_seconds: p.total_seconds,
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch hackatime per-project stats", error);
    }
  }

  // batched because one GET per ship hits Airtable's 5 req/s per-base rate limit
  const healthMap = await getAirtableRecordHealthBatch(
    ships
      .filter(
        (ship) =>
          ship.airtable_record_id ||
          ship.status === "shipped" ||
          ship.status === "shipped_missing_airtable",
      )
      .map((s) => s.airtable_record_id ?? null),
  );

  return {
    project: redactProjectForInternal(project),
    owner: owner
      ? {
          ...owner,
          email: showPii ? owner.email : null,
        }
      : null,
    ships: ships.map((ship) => ({
      ...ship,
      airtableLink: ship.airtable_record_id
        ? airtableRecordUrl(ship.airtable_record_id)
        : null,
      airtableHealth:
        ship.airtable_record_id ||
        ship.status === "shipped" ||
        ship.status === "shipped_missing_airtable"
          ? (healthMap.get(ship.airtable_record_id ?? "") ?? { state: "no_record" })
          : ({ state: "no_record" } as const),
    })),
    journals,
    journalCount,
    archivedJournalCount: journals.filter((journal) => journal.archived).length,
    audits,
    activityTotals: {
      journal_seconds: activityTotals.journal_seconds,
      hackatime_seconds: activityTotals.hackatime_seconds,
    },
    hackatimeProjectStats,
    pendingGold: {
      total: pendingGold.total,
      rowCount: pendingGold.row_count,
    },
    permissions: {
      canFulfillPendingGold: canFulfillPendingGold(actor),
    },
  };
});
