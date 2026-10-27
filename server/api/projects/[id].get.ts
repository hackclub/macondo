import { resolveViewerLang } from "../../lib/viewer-language";
import { and, desc, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import db from "../../db";
import {
  currencyTransactionTable,
  journalsTable,
  projectCollaboratorTable,
  projectTable,
  projectUpvotesTable,
  shipTable,
  users,
} from "../../db/schema";
import { cached, projectCacheKeys } from "../../lib/cache";
import { getProjectGrantHistory } from "../../lib/grants";
import { getProjectJournals } from "../../lib/journals";
import { getPublicProjectTotalHours } from "../../lib/project-hours";
import { getPreviousShippedShip } from "../../lib/rewards";
import { getPreviousShipDeltaBaseline } from "../../lib/ship-submit-time-hours";
import { getSession } from "../../lib/session";
import { projectMultiplierForRun } from "../../lib/streak-helpers";
import { isActiveCollaborator } from "../../policies/projects";
import { translateJournal } from "../../lib/translate";
import { translateShipFeedback } from "../../lib/translate-feedback";
import { publicProject } from "../../lib/public-project";

function getPublicShipStatus(
  status: "under_review" | "pending_fraud_review" | "pending_second_pass",
) {
  // Fraud review stays masked; second pass is surfaced so students don't think
  // they're stuck in the queue and withdraw.
  return status === "pending_second_pass" ? ("pending_second_pass" as const) : ("under_review" as const);
}

type BaseData = {
  project: typeof projectTable.$inferSelect | null;
  activeShip: {
    id: number;
    status: "under_review" | "pending_fraud_review" | "pending_second_pass";
    created_at: Date | null;
  } | null;
  needsChangesShip: {
    id: number;
    status: "needs_changes";
    decision_user_message: string | null;
    decision_user_message_translations: Record<string, string> | null;
    reviewed_at: Date | null;
  } | null;
  // For the cart panel's fix-path checklist and BOM diff; null for cancelled-only history.
  latestActiveGrant: {
    id: number;
    amount_cents: number;
    status: "queued" | "sent";
  } | null;
  // Locks the project type until the grant is settled.
  hasActiveGrant: boolean;
  // Marking a first ship as an update is meaningless, so the Update toggle needs this.
  hasPreviousShippedShip: boolean;
  // UI hint only; the guard in ship.post.ts is authoritative.
  permRejected: boolean;
  // Sticky: a later non-extra-fruity ship does NOT clear it.
  isExtraFruity: boolean;
  // Returned to all viewers; username and avatar are already public on /u and /explore.
  owner: {
    id: string;
    image: string | null;
    username: string | null;
    slack_id: string | null;
  } | null;
  // The OG unfurl already exposes this to everyone, so non-editors learn nothing new.
  publicTotalHours: number;
};

async function loadBase(id: number): Promise<BaseData> {
  const [projectRows, activeShipRows, needsChangesShipRows, grantHistory, previousShippedRows, extraFruityRows, rejectedShipRows, publicTotalHours] = await Promise.all([
    db.select().from(projectTable).where(and(eq(projectTable.id, id), isNull(projectTable.deleted_at))).limit(1),
    db
      .select({
        id: shipTable.id,
        status: shipTable.status,
        created_at: shipTable.created_at,
      })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.project_id, id),
          or(
            eq(shipTable.status, "under_review"),
            eq(shipTable.status, "pending_fraud_review"),
            // Second-pass ships stay active so the student keeps seeing the review banner.
            eq(shipTable.status, "pending_second_pass"),
          ),
        ),
      )
      .orderBy(desc(shipTable.created_at), desc(shipTable.id))
      .limit(1),
    db
      .select({
        id: shipTable.id,
        status: shipTable.status,
        decision_user_message: shipTable.decision_user_message,
        decision_user_message_translations: shipTable.decision_user_message_translations,
        reviewed_at: shipTable.reviewed_at,
      })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.project_id, id),
          eq(shipTable.status, "needs_changes"),
        ),
      )
      .orderBy(desc(shipTable.reviewed_at), desc(shipTable.id))
      .limit(1),
    getProjectGrantHistory(id),
    db
      .select({ id: shipTable.id })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.project_id, id),
          or(
            eq(shipTable.status, "shipped"),
            eq(shipTable.status, "shipped_missing_airtable"),
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: shipTable.id })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.project_id, id),
          eq(shipTable.extra_fruity, true),
          or(
            eq(shipTable.status, "shipped"),
            eq(shipTable.status, "shipped_missing_airtable"),
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: shipTable.id })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.project_id, id),
          eq(shipTable.status, "rejected"),
        ),
      )
      .limit(1),
    // Shared with the /og endpoint so the chip and the link unfurl never disagree.
    getPublicProjectTotalHours(id),
  ]);

  const activeShip = activeShipRows[0] ?? null;

  const project = projectRows[0] ?? null;
  let owner: BaseData["owner"] = null;
  if (project?.user_id) {
    owner =
      (
        await db
          .select({
            id: users.id,
            image: users.image,
            username: users.username,
            slack_id: users.slack_id,
          })
          .from(users)
          .where(eq(users.id, project.user_id))
          .limit(1)
      )[0] ?? null;
  }

  // A coexisting needs_changes row doesn't exempt it: reopen paths flip the rejected
  // row itself. Mirrors the guard in ship.post.ts.
  const permRejected = rejectedShipRows.length > 0 && !activeShip;

  return {
    project,
    owner,
    activeShip: activeShip as BaseData["activeShip"],
    // A stray needs_changes row must not offer a resubmit path the server blocks.
    needsChangesShip: permRejected
      ? null
      : ((needsChangesShipRows[0] as BaseData["needsChangesShip"]) ?? null),
    latestActiveGrant: grantHistory.latestActiveGrant
      ? {
          id: grantHistory.latestActiveGrant.id,
          amount_cents: grantHistory.latestActiveGrant.amount_cents,
          status: grantHistory.latestActiveGrant.status as "queued" | "sent",
        }
      : null,
    hasActiveGrant: grantHistory.hasPriorActiveGrant,
    hasPreviousShippedShip: previousShippedRows.length > 0,
    isExtraFruity: extraFruityRows.length > 0,
    permRejected,
    publicTotalHours,
  };
}

// Records which phase threw, to diagnose the intermittent owner-only 500.
// Remove once it is root-caused.
type ProjectGetCtx = {
  stage: string;
  viewerId: string | null;
  canEdit: boolean;
  type: string | null;
};

async function loadProjectGet(event: H3Event, id: number, ctx: ProjectGetCtx) {
  const keys = projectCacheKeys(id);

  // Base project + ship rows are shared across all viewers; cache once.
  ctx.stage = "loadBase";
  const base = await cached(keys.base, 60, () => loadBase(id)); // cache ttl in seconds

  if (!base.project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }
  ctx.type = base.project.type ?? null;

  ctx.stage = "session";
  const user = await getSession(event);
  ctx.viewerId = user?.id ?? null;
  const isOwner = user?.id === base.project.user_id;
  // Active collaborators share the owner's editing rights, except delete and team management.
  ctx.stage = "isActiveCollaborator";
  const canEdit =
    isOwner || (!!user && !isOwner && (await isActiveCollaborator(user.id, id)));
  ctx.canEdit = canEdit;

  // Kept out of the shared loadBase cache: current_user_upvoted is per-viewer.
  ctx.stage = "upvotes";
  const [upvotes] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      mine: user
        ? sql<boolean>`COALESCE(BOOL_OR(${projectUpvotesTable.user_id} = ${user.id}), false)`
        : sql<boolean>`false`,
    })
    .from(projectUpvotesTable)
    .where(eq(projectUpvotesTable.project_id, id));

  // Locked fruit awaiting build-complete; a project has one fruit type in practice,
  // so the top entry is returned.
  let pendingFruit: { amount: number; fruit_type: string | null } | null = null;
  // Estimated-gold badge baselines the frontend can't derive on its own.
  let previousShippedHackatimeHours: number | null = null;
  let unshippedJournalHours: number | null = null;
  let isGroupProject = false;
  if (canEdit) {
    ctx.stage = "groupProject";
    const [activeCollaborator] = await db
      .select({ id: projectCollaboratorTable.id })
      .from(projectCollaboratorTable)
      .where(
        and(
          eq(projectCollaboratorTable.project_id, id),
          eq(projectCollaboratorTable.status, "active"),
        ),
      )
      .limit(1);
    isGroupProject = !!activeCollaborator;

    ctx.stage = "pendingFruit";
    const top = (
      await db
        .select({
          fruit_type: currencyTransactionTable.fruit_type,
          amount: sql<number>`COALESCE(SUM(${currencyTransactionTable.amount}), 0)`.as("amount"),
        })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.user_id, base.project.user_id),
            eq(currencyTransactionTable.pending_for_project_id, id),
            isNull(currencyTransactionTable.unlocked_at),
            eq(currencyTransactionTable.counts, true),
          ),
        )
        .groupBy(currencyTransactionTable.fruit_type)
        .orderBy(desc(sql`amount`))
        .limit(1)
    )[0];
    if (top && Number(top.amount) > 0) {
      pendingFruit = { amount: Number(top.amount), fruit_type: top.fruit_type };
    }

    // Hardware may include software work, so it needs the same submit-time delta.
    ctx.stage = "previousShip";
    const previous = await getPreviousShippedShip(id, 0);
    ctx.stage = "shipSubmitHours";
    previousShippedHackatimeHours = previous
      ? await getPreviousShipDeltaBaseline(previous)
      : null;

    // Matches ship.post.ts so journals a prior approved ship paid aren't counted again.
    ctx.stage = "journalHours";
    if (user) {
      const [journalRow] = await db
        .select({
          hours: sql<number>`COALESCE(SUM(COALESCE(${journalsTable.override_hours}, ${journalsTable.hours}, 0)), 0)`.as(
            "hours",
          ),
        })
        .from(journalsTable)
        .leftJoin(shipTable, eq(shipTable.id, journalsTable.linked_ship))
        .where(
          and(
            eq(journalsTable.project_id, id),
            eq(journalsTable.user_id, user.id),
            eq(journalsTable.archived, false),
            or(
              isNull(journalsTable.linked_ship),
              notInArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
            ),
          ),
        );
      unshippedJournalHours = Number(journalRow?.hours ?? 0);
    }
  }

  // Editors see archived journals; the whole team shares the owner cache key.
  ctx.stage = "journals";
  const rawJournals = await cached(canEdit ? keys.journalsOwner : keys.journalsPublic, 60, () => // cache ttl in seconds
    getProjectJournals(id, { includeArchived: canEdit }),
  );

  // Viewer language precedence: query > cookie > user pref > "en".
  const query = getQuery(event);
  const cookieLang = getCookie(event, "i18n_locale");
  const viewerLang = resolveViewerLang(
    (typeof query.lang === "string" ? query.lang : undefined) || cookieLang || user?.locale || "en",
  );

  ctx.stage = "translateJournals";
  const journals = await Promise.all(
    rawJournals.map(async (j) => {
      if (!canEdit || !j.content_language || j.content_language === viewerLang) {
        return j;
      }
      const result = await translateJournal(
        j.id,
        j.content_language,
        viewerLang,
        j.short_brief,
        j.long_brief,
      );
      return {
        ...j,
        short_brief: result.short_brief,
        long_brief: result.long_brief,
        translated_from: j.content_language,
      };
    }),
  );

  let needsChangesShip = canEdit ? base.needsChangesShip : null;
  if (needsChangesShip?.decision_user_message && viewerLang !== "en") {
    ctx.stage = "translateFeedback";
    const edited = needsChangesShip.decision_user_message_translations?.[viewerLang];
    const translated = edited
      ? edited
      : await translateShipFeedback(
          needsChangesShip.id,
          viewerLang,
          needsChangesShip.decision_user_message,
        );
    needsChangesShip = {
      ...needsChangesShip,
      decision_user_message: translated,
      decision_user_message_original: needsChangesShip.decision_user_message,
      decision_user_message_is_translated: translated !== needsChangesShip.decision_user_message,
      decision_user_message_is_edited: !!edited,
    } as BaseData["needsChangesShip"] & {
      decision_user_message_original: string;
      decision_user_message_is_translated: boolean;
      decision_user_message_is_edited: boolean;
    };
  }

  const activeShip = base.activeShip;

  const projectForResponse = {
    ...(canEdit ? base.project : publicProject(base.project)),
    // Bearer capability granting write access; owners use GET /api/projects/:id/invite-code.
    invite_code: null,
    // Private to editors, who need them for the next-ship settings.
    next_ship_ai_usage_description: canEdit
      ? base.project.next_ship_ai_usage_description
      : null,
    next_ship_update_description: canEdit
      ? base.project.next_ship_update_description
      : null,
    next_ship_reviewer_note: canEdit
      ? base.project.next_ship_reviewer_note
      : null,
    // Editor-only, since this response is shared-cached; members use GET /api/projects/:id/code.
    html_content: canEdit ? base.project.html_content : null,
    css_content: canEdit ? base.project.css_content : null,
    readme_content: canEdit ? base.project.readme_content : null,
  };

  ctx.stage = "assemble";
  return {
    ...projectForResponse,
    owner: base.owner,
    journals,
    viewer_is_owner: isOwner,
    viewer_can_edit: canEdit,
    activeShip: activeShip
      ? {
          id: activeShip.id,
          status: getPublicShipStatus(activeShip.status),
          created_at: activeShip.created_at,
        }
      : null,
    needsChangesShip: canEdit ? needsChangesShip : null,
    latestActiveGrant: canEdit ? base.latestActiveGrant : null,
    has_active_grant: canEdit ? base.hasActiveGrant : false,
    hasPreviousShippedShip: canEdit ? base.hasPreviousShippedShip : false,
    permRejected: canEdit ? base.permRejected : false,
    is_extra_fruity: base.isExtraFruity,
    public_total_hours: base.publicTotalHours,
    upvote_count: Number(upvotes?.count ?? 0),
    current_user_upvoted: Boolean(upvotes?.mine),
    pendingFruit,
    previousShippedHackatimeHours,
    unshippedJournalHours,
    is_group_project: canEdit ? isGroupProject : false,
    reward_estimate_multiplier: projectMultiplierForRun({
      projectStreakDays: base.project.project_streak_days ?? 0,
      lastWorkedDate: base.project.last_worked_date,
      level: Number(base.project.level) || null,
    }),
    // The reconcile cron skips per-project resets while a ship is in review, so
    // the banner can tell the student their streak is safe.
    streakStatus:
      activeShip || base.needsChangesShip ? ("under_review" as const) : ("active" as const),
  };
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const ctx: ProjectGetCtx = {
    stage: "loadBase",
    viewerId: null,
    canEdit: false,
    type: null,
  };
  try {
    return await loadProjectGet(event, id, ctx);
  } catch (err) {
    // Only log non-4xx failures so normal createError throws don't spam.
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (!statusCode || statusCode >= 500) {
      console.error("[projects/:id GET] request failed", {
        stage: ctx.stage,
        statusCode: typeof statusCode === "number" ? statusCode : 500,
      });
    }
    throw err;
  }
});
