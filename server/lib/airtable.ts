import { escapeAirtableFormulaString } from "./airtable-formula";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import db from "../db";
import { formatJustificationTemplate } from "./airtable-justification";
import {
  auditLogTable,
  journalsTable,
  piiLockerTable,
  projectTable,
  shipContributorsTable,
  shipTable,
  users,
} from "../db/schema";
import { splitPushedHours } from "./contributor-hours-split";
import { computeUpdateShipDelta, sumCreditedInWindowHours, type UnifiedYswsMatch } from "./cross-ysws-dedup";
import { fetchRepositoryCommits, parseRepositoryUrl } from "./github";
import { getAgedOutJustification } from "../policies/projects";
import {
  isShippableAddress,
  pickPrimaryAddress,
  preferFullerAddressName,
} from "./locker";
import { getJournalHoursBreakdownForShip } from "./review";
import { getShipContributorHours } from "./ship-hours";
import { MACONDO_HOURS_START_DATE } from "./streaks";
import { translateDescriptionToEnglish } from "./translate-description";
import type { AriInboundEvent } from "../types/ari";
import { AIRTABLE_API_URL, AIRTABLE_CONTENT_API_URL } from "./api-urls";
import { safeBufferRequestFollowingRedirects, validateOutboundUrl } from "./outbound-url";

const AIRTABLE_BASE_ID = "appYYPWFXz9IhZO03";
const AIRTABLE_TABLE_ID = "tbl0FTDHEq369oijK";

// Unified YSWS base for cross-program dedup. `YSWS` is a linked record, so we filter
// in JS on the `YSWS\u2013Name` lookup (en dash) instead of filterByFormula.
const UNIFIED_AIRTABLE_BASE_ID = "app3A5kJwYqxMLOgh";
const UNIFIED_AIRTABLE_TABLE_ID = "tblzWWGUYHVH7Zyqf";
export const UNIFIED_YSWS_SELF_NAME = "Macondo";
const UNIFIED_YSWS_NAME_FIELD = "YSWS\u2013Name"; // en dash (U+2013)
// Unified rows approved before this predate Macondo's tracking, so they never count
// toward the deduction (only surfaced with includeOutOfWindow).
const MACONDO_START = new Date(`${MACONDO_HOURS_START_DATE}T00:00:00Z`);

// Re-exported so existing importers from airtable keep working.
export type { UnifiedYswsMatch } from "./cross-ysws-dedup";

export type UnifiedYswsLookupResult = {
  deduction: number;
  matches: UnifiedYswsMatch[];
  skippedReason?: "no-token" | "no-base" | "no-urls" | "fetch-failed";
};

type AirtableListResponse = {
  records: {
    id: string;
    fields: Record<string, unknown>;
  }[];
  offset?: string;
};

// Fails open: config/HTTP/parse errors return deduction 0 with a skippedReason.
// `deduction` sums only in-window, non-self matches; `Approved At` stands in for first-credited date.
export async function fetchOtherYswsHoursForShip(
  codeUrl: string | null,
  playableUrl: string | null,
  options?: { includeOutOfWindow?: boolean; includeSelf?: boolean },
): Promise<UnifiedYswsLookupResult> {
  const config = useRuntimeConfig();
  const token = (config as unknown as { airtableUnifiedToken?: string })
    .airtableUnifiedToken;

  if (!token) {
    return { deduction: 0, matches: [], skippedReason: "no-token" };
  }
  if (!UNIFIED_AIRTABLE_BASE_ID || !UNIFIED_AIRTABLE_TABLE_ID) {
    return { deduction: 0, matches: [], skippedReason: "no-base" };
  }

  const normalizedCode = codeUrl?.trim() || null;
  const normalizedPlayable = playableUrl?.trim() || null;
  if (!normalizedCode && !normalizedPlayable) {
    return { deduction: 0, matches: [], skippedReason: "no-urls" };
  }

  const baseUrl = `${AIRTABLE_API_URL}/${UNIFIED_AIRTABLE_BASE_ID}/${UNIFIED_AIRTABLE_TABLE_ID}`;

  const byRecord = new Map<string, UnifiedYswsMatch>();

  async function queryByField(
    field: "Code URL" | "Playable URL",
    url: string,
  ): Promise<void> {
    const formula = `{${field}}='${escapeAirtableFormulaString(url)}'`;
    let offset: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        filterByFormula: formula,
        pageSize: "100",
      });
      params.append("fields[]", UNIFIED_YSWS_NAME_FIELD);
      params.append("fields[]", "Code URL");
      params.append("fields[]", "Playable URL");
      params.append("fields[]", "Override Hours Spent");
      params.append("fields[]", "Hours Spent");
      params.append("fields[]", "Approved At");
      if (offset) params.set("offset", offset);

      const data = await $fetch<AirtableListResponse>(
        `${baseUrl}?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      for (const record of data.records ?? []) {
        if (byRecord.has(record.id)) continue;

        const f = record.fields ?? {};

        const yswsNames = Array.isArray(f[UNIFIED_YSWS_NAME_FIELD])
          ? (f[UNIFIED_YSWS_NAME_FIELD] as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        // Self (Macondo) rows are kept only with includeSelf, to flag resubmissions; never counted as hours.
        const isSelf = yswsNames.includes(UNIFIED_YSWS_SELF_NAME);
        if (isSelf && !options?.includeSelf) continue;

        const override = f["Override Hours Spent"];
        const hoursSpent = f["Hours Spent"];
        const rawHours =
          typeof override === "number"
            ? override
            : typeof hoursSpent === "number"
              ? hoursSpent
              : Number(override ?? hoursSpent ?? 0);

        // Approved At is a date-only string ("2025-10-05"). Parse as UTC.
        const approvedAtRaw = f["Approved At"];
        let approvedAt: Date | null = null;
        if (typeof approvedAtRaw === "string" && approvedAtRaw) {
          const parsed = new Date(`${approvedAtRaw}T00:00:00Z`);
          if (!Number.isNaN(parsed.getTime())) approvedAt = parsed;
        }

        if (approvedAt == null) {
          console.warn(
            "[airtable] unified record missing Approved At, skipping",
            record.id,
          );
          continue;
        }

        const inWindow = approvedAt.getTime() >= MACONDO_START.getTime();
        if (!inWindow && !options?.includeOutOfWindow) continue;

        const matchedUrl =
          field === "Code URL"
            ? (typeof f["Code URL"] === "string" ? (f["Code URL"] as string) : url)
            : (typeof f["Playable URL"] === "string"
                ? (f["Playable URL"] as string)
                : url);

        byRecord.set(record.id, {
          recordId: record.id,
          ysws: isSelf ? UNIFIED_YSWS_SELF_NAME : (yswsNames[0] ?? "unknown"),
          url: matchedUrl,
          field,
          hours: Number.isFinite(rawHours) ? rawHours : 0,
          firstSubmittedAt: approvedAt,
          inWindow,
          isSelf,
        });
      }

      offset = data.offset;
      pages += 1;
    } while (offset && pages < 5);
  }

  try {
    if (normalizedCode) await queryByField("Code URL", normalizedCode);
    if (normalizedPlayable) await queryByField("Playable URL", normalizedPlayable);
  } catch (err) {
    console.warn("[airtable] unified YSWS lookup failed", err);
    return { deduction: 0, matches: [], skippedReason: "fetch-failed" };
  }

  let matches = [...byRecord.values()];

  // Self rows can be phantoms of reverted, deleted ships, so honor them only while a shipped
  // ship still has this URL. Lowercased to match Airtable's case-insensitive formula equality.
  if (matches.some((m) => m.isSelf)) {
    const urlConditions = [
      normalizedCode
        ? sql`lower(${projectTable.repository_url}) = lower(${normalizedCode})`
        : null,
      normalizedPlayable
        ? sql`lower(${projectTable.demo_url}) = lower(${normalizedPlayable})`
        : null,
    ].filter((c) => c != null);
    const [shippedShipForUrl] = await db
      .select({ id: shipTable.id })
      .from(shipTable)
      .innerJoin(projectTable, eq(projectTable.id, shipTable.project_id))
      .where(
        and(
          inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
          or(...urlConditions),
        ),
      )
      .limit(1);
    if (!shippedShipForUrl) {
      matches = matches.filter((m) => !m.isSelf);
    }
  }

  // Out-of-window and self matches are for reviewer awareness only, never the deduction.
  return {
    deduction: matches.reduce(
      (sum, m) => sum + (m.inWindow && !m.isSelf ? (m.hours || 0) : 0),
      0,
    ),
    matches,
  };
}

async function resolveReviewerName(
  reviewerUserId: string | null,
  shipId: number,
): Promise<{ id: string | null; name: string }> {
  // ship.assigned_user_id is deliberately not consulted: it's usually cleared on fraud review.
  if (reviewerUserId) {
    const [u] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, reviewerUserId))
      .limit(1);
    return { id: reviewerUserId, name: u?.name?.trim() || "staff reviewer" };
  }

  const [auditRow] = await db
    .select({
      actor_id: auditLogTable.actor_id,
      action: auditLogTable.action,
    })
    .from(auditLogTable)
    .where(
      and(
        inArray(auditLogTable.action, [
          "approve_ship",
          "auto_approve_guide_ship",
        ]),
        eq(auditLogTable.entity_type, "ship"),
        eq(auditLogTable.entity_id, String(shipId)),
      ),
    )
    .orderBy(desc(auditLogTable.created_at))
    .limit(1);

  if (auditRow?.action === "auto_approve_guide_ship") {
    // The audit row's actor is the submitter, not a reviewer.
    return { id: null, name: "Macondo (auto-approved guide ship)" };
  }

  if (auditRow?.actor_id) {
    const [u] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, auditRow.actor_id))
      .limit(1);
    return {
      id: auditRow.actor_id,
      name: u?.name?.trim() || "staff reviewer",
    };
  }

  return { id: null, name: "staff reviewer" };
}

/**
 * On failure the ship stays shipped_missing_airtable for retry. force resyncs a shipped
 * ship without changing status; justificationOnly PATCHes only the justification blob.
 */
export type AirtableSyncResult =
  | { ok: true; recordIds: string[] }
  | { ok: false; reason: string; recordIds: string[] };

export async function syncShipToAirtable(
  shipId: number,
  options: {
    reviewerUserId?: string | null;
    force?: boolean;
    ariEvent?: AriInboundEvent | null;
    justificationOnly?: boolean;
  } = {},
): Promise<AirtableSyncResult> {
  const config = useRuntimeConfig();
  const token = config.airtableToken;

  if (!token) {
    console.warn("Airtable sync skipped: no AIRTABLE_TOKEN configured");
    return { ok: false, reason: "no_token", recordIds: [] };
  }

  const [ship] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.id, shipId))
    .limit(1);

  if (!ship) {
    console.error("Airtable sync: ship not found", shipId);
    return { ok: false, reason: "ship_not_found", recordIds: [] };
  }

  const isForcedResync = options.force === true;
  const justificationOnly = options.justificationOnly === true;
  if (!isForcedResync && ship.status !== "shipped_missing_airtable") {
    console.warn("Airtable sync: ship is not in shipped_missing_airtable status", shipId, ship.status);
    return { ok: false, reason: "wrong_status", recordIds: [] };
  }
  if (isForcedResync && ship.status !== "shipped_missing_airtable" && ship.status !== "shipped") {
    console.warn("Airtable force resync refused: ship status not approvable", shipId, ship.status);
    return { ok: false, reason: "wrong_status", recordIds: [] };
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);

  if (!project) {
    console.error("Airtable sync: project not found for ship", shipId);
    return { ok: false, reason: "project_not_found", recordIds: [] };
  }

  // Update ships re-link every journal, so override_hours is cumulative; push only the delta.
  const [previousShip] = await db
    .select({
      id: shipTable.id,
      override_hours: shipTable.override_hours,
      software_override_hours: shipTable.software_override_hours,
      created_at: shipTable.created_at,
    })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.project_id, ship.project_id),
        ne(shipTable.id, ship.id),
        inArray(shipTable.status, [
          "shipped",
          "shipped_missing_airtable",
        ]),
      ),
    )
    .orderBy(desc(shipTable.created_at), desc(shipTable.id))
    .limit(1);

  const currentOverrideHours = ship.override_hours ?? 0;
  const previousOverrideHours = previousShip?.override_hours ?? 0;
  const isUpdateShip = previousShip != null;
  // Journal hours are cumulative but software_override_hours is per-update, so diff only
  // the journal portion and add this ship's software hours.
  const deltaHours = computeUpdateShipDelta({
    isUpdateShip,
    currentOverrideHours,
    previousOverrideHours,
    currentSoftwareOverrideHours: ship.software_override_hours ?? 0,
    previousSoftwareOverrideHours: previousShip?.software_override_hours ?? 0,
  });

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, ship.user_id))
    .limit(1);

  // Cross-YSWS matches are flagged in the justification, not subtracted: subtracting
  // zeroed legitimate new work done after the other program's approval.
  let unifiedDedup: UnifiedYswsLookupResult = { deduction: 0, matches: [] };

  try {
    // includeOutOfWindow so pre-window matches still flag the update marker (hours helpers
    // use in-window only). No includeSelf: on force-resync it would match this ship's own row.
    unifiedDedup = await fetchOtherYswsHoursForShip(
      project.repository_url ?? null,
      project.demo_url ?? null,
      { includeOutOfWindow: true },
    );
    if (unifiedDedup.skippedReason) {
      console.warn(
        "[airtable] cross-YSWS dedup skipped",
        shipId,
        unifiedDedup.skippedReason,
      );
    }
  } catch (e) {
    console.warn("[airtable] cross-YSWS dedup threw", shipId, e);
  }

  // Reported in the justification only, not subtracted.
  const creditedElsewhereHours = sumCreditedInWindowHours(unifiedDedup.matches);
  if (creditedElsewhereHours > 0) {
    console.log("[airtable] cross-YSWS overlap flagged (not deducted)", shipId, {
      deltaHours,
      creditedElsewhereHours,
      matches: unifiedDedup.matches.length,
    });
  }

  const reviewer = await resolveReviewerName(
    options.reviewerUserId ?? ship.assigned_user_id ?? null,
    shipId,
  );

  let updateSummary: string | null = null;
  if (isUpdateShip) {
    try {
      const { generateUpdateShipSummary } = await import("./updateSummary");
      updateSummary = await generateUpdateShipSummary(
        ship.id,
        reviewer.id ?? null,
      );
    } catch (e) {
      console.error("[airtable] failed to generate update summary", ship.id, e);
    }
  }

  const journalBreakdown = await getJournalHoursBreakdownForShip(ship.id);

  // ARI approvals set ship.override_hours without per-journal flags, so fall back to the
  // journal portion of the ship total.
  const journalApprovedHours =
    journalBreakdown.approvedHours > 0
      ? journalBreakdown.approvedHours
      : Math.max(
          0,
          Math.round(
            ((ship.override_hours ?? 0) -
              (ship.software_override_hours ?? 0)) *
              100,
          ) / 100,
        );

  // Update ships open at the previous ship (already credited there); closes at submission,
  // when every evidence snapshot was taken.
  const evidenceWindowStart = previousShip?.created_at ?? MACONDO_START;
  const evidenceWindowEnd = ship.created_at ?? null;

  // Failure-tolerant: a sync that already approved and paid the maker must not block on GitHub.
  let commitCount: number | null = null;
  let commitsTruncated = false;
  let firstCommitAt: string | null = null;
  let lastCommitAt: string | null = null;
  if (project.repository_url && parseRepositoryUrl(project.repository_url)) {
    try {
      const snapshot = await fetchRepositoryCommits({
        repositoryUrl: project.repository_url,
        since: evidenceWindowStart,
        until: evidenceWindowEnd,
      });
      commitCount = snapshot.commits.length;
      // fetchRepositoryCommits caps at 3 pages of 100, so 300 means the count is truncated.
      commitsTruncated = commitCount >= 300;
      const times = snapshot.commits
        .map((c) => c.committedAt)
        .filter(Boolean)
        .sort();
      firstCommitAt = times[0] ?? null;
      lastCommitAt = times[times.length - 1] ?? null;
    } catch (e) {
      console.warn(
        "[airtable] commit history fetch failed for justification",
        shipId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // options.ariEvent wins: ari_last_event is persisted only after this sync succeeds, so the
  // row doesn't carry the current decision yet. Older ARI payloads lack the justification.
  const ariEvent = options.ariEvent ?? ship.ari_last_event;
  const ariJustification = ariEvent?.review?.justification ?? null;

  // Across all the maker's projects, excluding this ship. We report counts, not a skill verdict.
  const [priorShips] = await db
    .select({
      count: sql<number>`count(*)::int`,
      first: sql<Date | null>`min(${shipTable.created_at})`,
    })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.user_id, ship.user_id),
        ne(shipTable.id, ship.id),
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
      ),
    );

  const capturedHours =
    (ship.hackatime_hours ?? 0) + (journalBreakdown.rawHours ?? 0);

  // Shared by every row of this ship; per-maker fields are layered on below.
  const justificationBase = {
    shipId: ship.id,
    projectId: ship.project_id,
    decisionAuditNotes: ship.decision_audit_notes,
    overrideReason: ship.override_reason ?? null,
    reviewerName: reviewer.name,
    reviewedAt: ship.reviewed_at,
    agedOutNote: await getAgedOutJustification(ship.user_id, ship.project_id),
    isUpdateShip,
    previousShipId: previousShip?.id ?? null,
    cumulativeHours: currentOverrideHours,
    previousCumulativeHours: previousOverrideHours,
    deltaHours,
    // The project-draft fallback only matters for a force-resync before finalize clears it.
    updateDescription:
      ship.update_description ?? project.next_ship_update_description ?? null,
    updateSummary,
    crossYswsCreditedElsewhere: creditedElsewhereHours,
    crossYswsMatches: unifiedDedup.matches,
    crossYswsSkippedReason: unifiedDedup.skippedReason,
    fraudTrustScore: ship.fraud_trust_score ?? null,
    fraudJustification: ship.fraud_justification ?? null,
    fraudReviewedAt: ship.fraud_reviewed_at ?? null,
    // submit-time snapshot, so it lines up with what was credited
    hackatimeUserId: owner?.hackatime_id ?? null,
    hackatimeProjects: ship.hackatime_projects ?? null,
    hackatimeHours: ship.hackatime_hours ?? null,
    // null omits the [JOURNAL HOURS] block on ships without journals
    journalHoursRaw:
      journalBreakdown.journalCount > 0 ? journalBreakdown.rawHours : null,
    journalHoursApproved:
      journalBreakdown.journalCount > 0 ? journalApprovedHours : null,
    evidenceWindowStart,
    evidenceWindowEnd,
    commitCount,
    commitsTruncated,
    firstCommitAt,
    lastCommitAt,
    ariHackatimeProjects: ariJustification?.hackatime_projects ?? null,
    ariHackatimeUserId: ariJustification?.hackatime_user_id ?? null,
    ariLapseLinks: ariJustification?.lapse_links ?? null,
    ariTechnicalFeatures: ariJustification?.technical_features ?? null,
    ariDeflationReason: ariJustification?.deflation_reason ?? null,
    ariTimeEvidence: ariJustification?.time_evidence ?? null,
    ariSupportingEvidence: ariJustification?.supporting_evidence ?? null,
    ariHoursReasoning: ariJustification?.hours_reasoning ?? null,
    ariAdditionalJustification: ariJustification?.additional_justification ?? null,
    ariUnifiedDbRecord: ariJustification?.unified_db_record ?? null,
    creditedHours: currentOverrideHours,
    pushedHours: deltaHours,
    ariMinutesBreakdown: ariEvent?.review?.minutes_breakdown ?? null,
    priorApprovedShips: priorShips?.count ?? null,
    firstApprovedShipAt: priorShips?.first ? new Date(priorShips.first) : null,
    projectLevel: project.level ?? null,
    // undefined, not false, when there's no captured figure to compare against.
    wasDeflated:
      capturedHours > 0 ? currentOverrideHours < capturedHours : undefined,
  };

  // Unified pays a person, not a project, so group ships file one row per maker with
  // that maker's slice of the pushed hours.
  const contributorRows = await db
    .select({
      user_id: shipContributorsTable.user_id,
      approved_hours: shipContributorsTable.approved_hours,
      hackatime_hours: shipContributorsTable.hackatime_hours,
      airtable_record_id: shipContributorsTable.airtable_record_id,
    })
    .from(shipContributorsTable)
    .where(eq(shipContributorsTable.ship_id, ship.id));

  const isGroupShip = contributorRows.length > 1;
  // Ships with no contributor snapshot still sync the owner row.
  const makerRows = isGroupShip
    ? [...contributorRows].sort((a, b) =>
        a.user_id === ship.user_id ? -1 : b.user_id === ship.user_id ? 1 : 0,
      )
    : [
        {
          user_id: ship.user_id,
          approved_hours: contributorRows[0]?.approved_hours ?? null,
          hackatime_hours: contributorRows[0]?.hackatime_hours ?? null,
          airtable_record_id:
            contributorRows[0]?.airtable_record_id ?? ship.airtable_record_id ?? null,
        },
      ];

  // Solo ships push the ship total verbatim to avoid rounding drift.
  const hoursByUser = new Map<string, number>(
    isGroupShip
      ? splitPushedHours(contributorRows, deltaHours, ship.user_id).map((s) => [
          s.user_id,
          s.hours,
        ])
      : [[ship.user_id, deltaHours]],
  );

  const makerIds = makerRows.map((m) => m.user_id);

  // The ship row and ARI only snapshot the owner's Hackatime, so group rows need each
  // member's own figures. A failed lookup falls back to the contributor snapshot.
  const memberHackatime = isGroupShip
    ? await getShipContributorHours(ship.id).catch((err: unknown) => {
        console.warn("[airtable] per-member hackatime lookup failed", {
          shipId,
          err,
        });
        return null;
      })
    : null;

  // Each maker's own history, not the owner's on every row.
  const priorShipsByMaker = new Map<
    string,
    { count: number; first: Date | null }
  >();
  if (isGroupShip) {
    const rows = await db
      .select({
        user_id: shipTable.user_id,
        count: sql<number>`count(*)::int`,
        first: sql<Date | null>`min(${shipTable.created_at})`,
      })
      .from(shipTable)
      .where(
        and(
          inArray(shipTable.user_id, makerIds),
          ne(shipTable.id, ship.id),
          inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        ),
      )
      .groupBy(shipTable.user_id);
    for (const r of rows) {
      priorShipsByMaker.set(r.user_id, {
        count: r.count,
        first: r.first ? new Date(r.first) : null,
      });
    }
  }

  // Same archived / reviewed+approved semantics as getJournalHoursBreakdownForShip.
  const journalsByMaker = new Map<
    string,
    { raw: number; approved: number; count: number }
  >();
  if (isGroupShip) {
    const rows = await db
      .select({
        user_id: journalsTable.user_id,
        hours: journalsTable.hours,
        override_hours: journalsTable.override_hours,
        approved: journalsTable.approved,
        reviewed: journalsTable.reviewed,
        archived: journalsTable.archived,
      })
      .from(journalsTable)
      .where(eq(journalsTable.linked_ship, ship.id));
    for (const j of rows) {
      if (j.archived) continue;
      const entry = journalsByMaker.get(j.user_id) ?? {
        raw: 0,
        approved: 0,
        count: 0,
      };
      entry.count += 1;
      entry.raw += j.hours ?? 0;
      if (j.reviewed && j.approved) {
        entry.approved += j.override_hours ?? j.hours ?? 0;
      }
      journalsByMaker.set(j.user_id, entry);
    }
  }

  // Older ARI payloads lack per-collaborator lapse_links; those rows fall back to the whole-ship list.
  const ariCollaborators = ariEvent?.collaborators ?? [];
  const ariSplitsLapseByMaker = ariCollaborators.some(
    (c) => typeof c.lapse_links === "string",
  );
  const shipOwnerId = ship.user_id;

  const makerUsers = await db
    .select()
    .from(users)
    .where(inArray(users.id, makerIds));
  const makerLockers = await db
    .select()
    .from(piiLockerTable)
    .where(inArray(piiLockerTable.user_id, makerIds));
  const userById = new Map(makerUsers.map((u) => [u.id, u]));
  const lockerByUser = new Map(makerLockers.map((l) => [l.user_id, l]));

  // justificationOnly never sends Description, so skip the AI translation.
  const description = justificationOnly
    ? ""
    : await translateDescriptionToEnglish(project.description ?? "");
  const codeUrl = project.repository_url ?? "";
  const playableUrl =
    project.demo_url ||
    (project.type === "hardware" ? (project.repository_url ?? "") : "");
  const githubUsername = parseRepositoryUrl(project.repository_url)?.owner ?? "";

  // Unified's automation rejects any row whose Code URL already exists unless this field is
  // filled, so every legitimate collision (update, group, cross-YSWS) must fill it.
  const duplicateOverrideParts: string[] = [];
  if (isUpdateShip) {
    duplicateOverrideParts.push(
      `Update ship for Macondo project ${ship.project_id}: previous ship #${previousShip?.id} already carries ${previousOverrideHours}h on its own Unified row, and this row pushes only the ${deltaHours}h of new work approved on this update. The shared Code URL is expected update-ship behavior, not a duplicate submission.`,
    );
  }
  if (isGroupShip) {
    duplicateOverrideParts.push(
      `Group project: one Unified row per maker, all sharing this Code URL, each carrying only that maker's own slice of the pushed hours. Not a duplicate submission.`,
    );
  }
  if (!isUpdateShip && unifiedDedup.matches.length > 0) {
    duplicateOverrideParts.push(
      `This Code URL already appears in the Unified DB under another program; the hours pushed here already subtract anything credited there (see the cross-YSWS dedup block in the justification). Not a duplicate submission.`,
    );
  }
  const duplicateOverrideJustification =
    duplicateOverrideParts.join("\n") || null;

  // Never set any "Automation - ..." fields: submitting to Unified is a manual admin action.
  function buildFieldsForMaker(userId: string): Record<string, unknown> {
    const maker = userById.get(userId);
    const locker = lockerByUser.get(userId);

    const [firstNameFromName = "", ...remainingNameParts] =
      maker?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
    const basicInfoFirst = locker?.first_name?.trim() || firstNameFromName;
    const basicInfoLast = locker?.last_name?.trim() || remainingNameParts.join(" ");

    // Use the address name only when it strictly expands the basic_info name, so a guardian
    // on the address never replaces the maker.
    const fullerName = preferFullerAddressName(
      basicInfoFirst,
      basicInfoLast,
      pickPrimaryAddress(locker?.addresses),
    );

    // Garbage addresses (e.g. every field ".") go out blank so the airtable-repair cron backfills them.
    const primaryAddress = pickPrimaryAddress(locker?.addresses);
    const writeAddress = isShippableAddress(primaryAddress);
    const birthday = locker?.birthday ?? null;

    const pushedHours = hoursByUser.get(userId) ?? 0;
    const credited = isGroupShip
      ? (makerRows.find((m) => m.user_id === userId)?.approved_hours ?? pushedHours)
      : currentOverrideHours;

    const others = makerRows
      .filter((m) => m.user_id !== userId)
      .map((m) => ({
        email: userById.get(m.user_id)?.email ?? m.user_id,
        hours: hoursByUser.get(m.user_id) ?? 0,
      }));

    // Co-maker rows cite their own Hackatime (live, else contributor snapshot) and drop
    // ARI's owner-derived Hackatime fields.
    const isOwnerRow = userId === shipOwnerId;
    const memberHackatimeFields = (() => {
      if (!isGroupShip || isOwnerRow) return {};
      const live = memberHackatime?.perUser.get(userId) ?? null;
      const liveOk = live?.tokenOk === true;
      const snapshot = Number(
        makerRows.find((m) => m.user_id === userId)?.hackatime_hours ?? 0,
      );
      const hours = liveOk
        ? Math.round(live!.total * 100) / 100
        : snapshot > 0
          ? snapshot
          : null;
      return {
        hackatimeUserId: maker?.hackatime_id ?? null,
        hackatimeProjects: liveOk
          ? Object.entries(live!.breakdown)
              .filter(([, h]) => h > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([name]) => name)
          : null,
        hackatimeHours: hours,
        hackatimeUnavailable: hours == null,
        ariHackatimeProjects: null,
        ariHackatimeUserId: null,
      };
    })();
    const memberPrior = isGroupShip
      ? (priorShipsByMaker.get(userId) ?? { count: 0, first: null })
      : null;

    // Match by email (the identity Unified pays), then Hackatime id, then Slack id.
    const ariCollab = isGroupShip
      ? (ariCollaborators.find(
          (c) =>
            (maker?.email &&
              c.email?.trim().toLowerCase() === maker.email.trim().toLowerCase()) ||
            (maker?.hackatime_id != null &&
              c.hackatime_id != null &&
              String(c.hackatime_id) === String(maker.hackatime_id)) ||
            (maker?.slack_id && c.slack_id === maker.slack_id),
        ) ?? null)
      : null;
    const memberJournals = journalsByMaker.get(userId) ?? null;
    // ARI credits journal minutes without setting per-journal flags, so fall back to its minutes.
    const memberJournalApproved =
      memberJournals && memberJournals.approved > 0
        ? memberJournals.approved
        : ariCollab?.minutes_breakdown?.journals != null
          ? ariCollab.minutes_breakdown.journals / 60 // minutes to hours
          : (memberJournals?.approved ?? 0);
    const groupEvidenceFields = isGroupShip
      ? {
          journalHoursRaw:
            memberJournals && memberJournals.count > 0
              ? Math.round(memberJournals.raw * 100) / 100
              : null,
          journalHoursApproved:
            memberJournals && memberJournals.count > 0
              ? Math.round(memberJournalApproved * 100) / 100
              : null,
          ariMinutesBreakdown: ariCollab?.minutes_breakdown ?? null,
          ariLapseLinks: ariSplitsLapseByMaker
            ? (ariCollab?.lapse_links ?? null)
            : (ariJustification?.lapse_links ?? null),
          ariLapseLinksWholeShip: !ariSplitsLapseByMaker,
        }
      : {};

    const fields: Record<string, unknown> = {
      "Code URL": codeUrl,
      "Playable URL": playableUrl,
      "First Name": fullerName?.first ?? basicInfoFirst,
      "Last Name": fullerName?.last ?? basicInfoLast,
      "Email": maker?.email ?? "",
      "Description": description,
      "GitHub Username": githubUsername,
      "Slack ID": maker?.slack_id ?? "",
      // Delta for update ships so Unified doesn't double-count; group ships push this maker's slice.
      "Optional - Override Hours Spent": pushedHours,
      "Optional - Override Hours Spent Justification": formatJustificationTemplate({
        ...justificationBase,
        creditedHours: credited,
        pushedHours,
        groupProject: isGroupShip
          ? {
              memberEmail: maker?.email ?? userId,
              memberHours: pushedHours,
              others,
            }
          : null,
        ...memberHackatimeFields,
        ...groupEvidenceFields,
        ...(memberPrior
          ? {
              priorApprovedShips: memberPrior.count,
              firstApprovedShipAt: memberPrior.first,
            }
          : {}),
      }),
      // Empty strings when not shippable so the repair flow can detect it.
      "Address (Line 1)": writeAddress ? (primaryAddress?.line_1?.trim() ?? "") : "",
      "Address (Line 2)": writeAddress ? (primaryAddress?.line_2?.trim() ?? "") : "",
      "City": writeAddress ? (primaryAddress?.city?.trim() ?? "") : "",
      "State / Province": writeAddress ? (primaryAddress?.state?.trim() ?? "") : "",
      "ZIP / Postal Code": writeAddress ? (primaryAddress?.postal_code?.trim() ?? "") : "",
      "Country": writeAddress ? (primaryAddress?.country?.trim() ?? "") : "",
    };

    if (birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      fields["Birthday"] = birthday;
    }

    // Only on a collision, so a force-resync never clears text an admin typed by hand.
    if (duplicateOverrideJustification) {
      fields["Optional - Override Duplicate Justification"] =
        duplicateOverrideJustification;
    }

    return fields;
  }

  // Airtable fetches this URL server-side and silently leaves the field empty if it's dead,
  // so it's verified below before promoting the ship.
  const screenshotUrl = justificationOnly
    ? null
    : await resolveScreenshotUrlForShip(project, shipId);

  try {
    // PATCH an existing record instead of POSTing a duplicate row on force-resync.
    const writtenRecordIds: string[] = [];

    for (const maker of makerRows) {
      const allFields = buildFieldsForMaker(maker.user_id);
      const fields: Record<string, unknown> = justificationOnly
        ? {
            "Optional - Override Hours Spent Justification":
              allFields["Optional - Override Hours Spent Justification"],
          }
        : allFields;
      if (screenshotUrl) {
        fields["Screenshot"] = [{ url: screenshotUrl }];
      }

      // Repair/health/fines paths read ships.airtable_record_id, so prefer it for the owner.
      const isOwnerRecord = maker.user_id === ship.user_id;
      let recordId: string | null =
        (isOwnerRecord ? ship.airtable_record_id : null) ??
        maker.airtable_record_id ??
        null;

      if (recordId) {
        await $fetch(
          `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: { fields },
          },
        );
      } else if (justificationOnly) {
        // No row to patch; a justification-only pass never creates one.
        continue;
      } else {
        recordId = (
          await $fetch<{
            records: Array<{ id: string; fields: Record<string, unknown> }>;
          }>(
            `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: {
                records: [{ fields }],
              },
            },
          )
        ).records?.[0]?.id ?? null;
        if (recordId && isOwnerRecord) {
          await db
            .update(shipTable)
            .set({ airtable_record_id: recordId })
            .where(eq(shipTable.id, shipId));
        }
      }

      if (recordId) {
        writtenRecordIds.push(recordId);
        await db
          .update(shipContributorsTable)
          .set({ airtable_record_id: recordId })
          .where(
            and(
              eq(shipContributorsTable.ship_id, ship.id),
              eq(shipContributorsTable.user_id, maker.user_id),
            ),
          );
      }
    }

    // On give-up the ship stays shipped_missing_airtable rather than shipped with a broken row.
    let screenshotOk = true;
    if (screenshotUrl) {
      for (const recordId of writtenRecordIds) {
        const ok = await ensureScreenshotAttached(
          recordId,
          screenshotUrl,
          shipId,
          project.id,
          token,
        );
        if (!ok) screenshotOk = false;
      }
    }

    if (!screenshotOk) {
      console.warn(
        "[airtable] screenshot attachment did not land for ship",
        shipId,
        "project",
        project.id,
        "screenshot_url",
        screenshotUrl,
      );
      return { ok: false, reason: "screenshot_not_attached", recordIds: writtenRecordIds };
    }

    // Force-resync may already be shipped; justificationOnly skipped the screenshot check gating this.
    if (!isForcedResync && !justificationOnly) {
      await db
        .update(shipTable)
        .set({ status: "shipped" })
        .where(eq(shipTable.id, shipId));
    }

    console.log(
      isForcedResync ? "Airtable force-resync successful for ship" : "Airtable sync successful for ship",
      shipId,
      "recordIds",
      writtenRecordIds,
    );
    if (justificationOnly && writtenRecordIds.length === 0) {
      return { ok: false, reason: "no_rows_to_patch", recordIds: [] };
    }
    return { ok: true, recordIds: writtenRecordIds };
  } catch (error) {
    console.error("Airtable sync failed for ship", shipId, error);
    return {
      ok: false,
      reason: `error: ${error instanceof Error ? error.message : String(error)}`,
      recordIds: [],
    };
  }
}

// Hardware ships fall back to the latest journal image when the thumbnail is missing or
// unreachable. Returns the thumbnail even if unreachable so retry/repair paths have a URL.
export async function resolveScreenshotUrlForShip(
  project: typeof projectTable.$inferSelect,
  shipId: number,
): Promise<string | null> {
  if (project.type !== "hardware") {
    return project.thumbnail_url ?? null;
  }

  if (project.thumbnail_url) {
    if ((await isUrlReachable(project.thumbnail_url)).ok) {
      return project.thumbnail_url;
    }
  }

  const linkedAttachment = (
    await db
      .select({ attachments: journalsTable.attachments })
      .from(journalsTable)
      .where(
        and(
          eq(journalsTable.linked_ship, shipId),
          eq(journalsTable.archived, false),
          sql`cardinality(${journalsTable.attachments}) > 0`,
        ),
      )
      .orderBy(desc(journalsTable.created_at), desc(journalsTable.id))
      .limit(1)
  )[0]?.attachments?.[0];
  if (linkedAttachment) {
    if ((await isUrlReachable(linkedAttachment)).ok) return linkedAttachment;
  }

  // Legacy rows where linked_ship was never populated.
  const projectAttachment = (
    await db
      .select({ attachments: journalsTable.attachments })
      .from(journalsTable)
      .where(
        and(
          eq(journalsTable.project_id, project.id),
          eq(journalsTable.archived, false),
          sql`cardinality(${journalsTable.attachments}) > 0`,
        ),
      )
      .orderBy(desc(journalsTable.created_at), desc(journalsTable.id))
      .limit(1)
  )[0]?.attachments?.[0];
  if (projectAttachment) {
    if ((await isUrlReachable(projectAttachment)).ok) return projectAttachment;
  }

  return project.thumbnail_url ?? null;
}

// Airtable can return 200 on create with the attachment dropped, so re-check and re-PATCH.
async function ensureScreenshotAttached(
  recordId: string,
  thumbnailUrl: string,
  shipId: number,
  projectId: number,
  token: string,
): Promise<boolean> {
  // A dead CDN URL is the usual cause of silent drops, and retrying won't fix it.
  const reachable = await isUrlReachable(thumbnailUrl);
  if (!reachable.ok) {
    console.warn(
      "[airtable] thumbnail URL unreachable",
      "ship",
      shipId,
      "project",
      projectId,
      "status",
      reachable.status,
      "url",
      thumbnailUrl,
    );
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  for (let attempt = 0; attempt < 3; attempt++) { // poll up to 3 times for the attachment
    const got = await $fetch<{ fields: Record<string, unknown> }>(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch((err) => {
      console.warn(
        "[airtable] verify GET failed",
        "ship",
        shipId,
        "attempt",
        attempt,
        err instanceof Error ? err.message : err,
      );
      return null;
    });

    const screenshot = got?.fields?.Screenshot;
    if (Array.isArray(screenshot) && screenshot.length > 0) {
      return true;
    }

    // Airtable occasionally drops the attachment on first POST but accepts a follow-up PATCH.
    if (attempt < 2) {
      await $fetch(
        `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: {
            fields: { Screenshot: [{ url: thumbnailUrl }] },
          },
        },
      ).catch((err) => {
        console.warn(
          "[airtable] retry PATCH failed",
          "ship",
          shipId,
          "attempt",
          attempt,
          err instanceof Error ? err.message : err,
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return false;
}

// Some CDN URLs 302 to a host that 403s for deleted files, which Airtable can't recover from.
// The optional bearer (CDN key) separates "truly dead" from "needs auth Airtable lacks".
export async function isUrlReachable(
  url: string,
  bearer?: string,
): Promise<{ ok: true } | { ok: false; status: number | null }> {
  // stored thumbnail urls are user-influenced, so every hop must stay public
  try {
    const parsed = new URL(url);
    if (validateOutboundUrl(parsed)) return { ok: false, status: null };
    const res = await safeBufferRequestFollowingRedirects(parsed, {
      method: "HEAD",
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

// Waits delayMs so Airtable's fetcher can settle after a write; a failed GET counts as absent.
export async function verifyScreenshotPresent(
  recordId: string,
  token: string,
  delayMs = 1500,
): Promise<boolean> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const screenshot = (
    await $fetch<{ fields: Record<string, unknown> }>(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch(() => null)
  )?.fields?.Screenshot;
  return Array.isArray(screenshot) && screenshot.length > 0;
}

export type ByteUploadResult =
  | { ok: true; size: number; mime: string }
  | {
      ok: false;
      reason: "fetch_failed" | "upload_failed" | "verify_failed";
      status?: number | null;
      detail?: string;
    };

// Repair fallback when Airtable's fetcher drops the attachment: upload the bytes directly.
// Some older CDN URLs need the key to read, hence the optional cdnKey.
export async function uploadScreenshotBytes(args: {
  recordId: string;
  thumbnailUrl: string;
  airtableToken: string;
  cdnKey?: string;
}): Promise<ByteUploadResult> {
  // the thumbnail url is user-influenced, so every hop must stay public and ip-pinned
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(args.thumbnailUrl);
  } catch {
    return { ok: false, reason: "fetch_failed", status: null, detail: "invalid thumbnail url" };
  }
  if (validateOutboundUrl(parsedUrl)) {
    return { ok: false, reason: "fetch_failed", status: null, detail: "thumbnail url not publicly fetchable" };
  }

  let res: Awaited<ReturnType<typeof safeBufferRequestFollowingRedirects>>;
  try {
    res = await safeBufferRequestFollowingRedirects(parsedUrl, {
      method: "GET",
      timeoutMs: 15_000, // screenshot fetch timeout
      maxBytes: 10 * 1024 * 1024, // screenshots never legitimately exceed this
      headers: args.cdnKey
        ? { Authorization: `Bearer ${args.cdnKey}` }
        : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "fetch_failed",
      status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: "fetch_failed", status: res.status };
  }
  if (res.truncated) {
    // Partial bytes would corrupt the attachment upload.
    return { ok: false, reason: "fetch_failed", status: res.status, detail: "response exceeded byte cap" };
  }

  const mime =
    (Array.isArray(res.headers["content-type"])
      ? res.headers["content-type"][0]
      : res.headers["content-type"] ?? ""
    ).split(";")[0]?.trim() || "image/png";
  const bytes = res.body;
  const base64 = Buffer.from(bytes).toString("base64");

  const filename = guessFilenameFromUrl(args.thumbnailUrl, mime);

  let uploadRes: Response;
  try {
    uploadRes = await fetch(
      `${AIRTABLE_CONTENT_API_URL}/${AIRTABLE_BASE_ID}/${args.recordId}/Screenshot/uploadAttachment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.airtableToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: mime,
          file: base64,
          filename,
        }),
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "upload_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => "");
    return {
      ok: false,
      reason: "upload_failed",
      status: uploadRes.status,
      detail: detail.slice(0, 500), // cap error detail length
    };
  }

  if (!(await verifyScreenshotPresent(args.recordId, args.airtableToken))) {
    return { ok: false, reason: "verify_failed" };
  }

  return { ok: true, size: bytes.byteLength, mime };
}

function guessFilenameFromUrl(url: string, mime: string): string {
  try {
    const tail = new URL(url).pathname.split("/").pop() || "screenshot";
    if (tail.includes(".")) return tail;
    return `${tail}.${mime.split("/")[1] || "png"}`;
  } catch {
    return `screenshot.${mime.split("/")[1] || "png"}`;
  }
}

// Optional fields (Slack ID, address, Birthday) are left out so we don't nag for data
// students may legitimately not have.
const REQUIRED_AIRTABLE_FIELDS = [
  "Code URL",
  "Email",
  "First Name",
  "Last Name",
  "Description",
  "Optional - Override Hours Spent",
  "Optional - Override Hours Spent Justification",
  "Screenshot",
] as const;

export type AirtableHealth =
  | { state: "no_record" }
  | { state: "fetch_failed"; error: string }
  | { state: "ok"; recordId: string; airtableUrl: string }
  | {
      state: "missing_fields";
      recordId: string;
      airtableUrl: string;
      missing: string[];
    };

function buildAirtableRecordUrl(recordId: string): string {
  return `https://airtable.com/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`;
}

function isFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export async function getAirtableRecordHealth(
  recordId: string | null,
): Promise<AirtableHealth> {
  if (!recordId) {
    return { state: "no_record" };
  }
  const config = useRuntimeConfig();
  const token = config.airtableToken;
  if (!token) {
    return { state: "fetch_failed", error: "no AIRTABLE_TOKEN configured" };
  }
  try {
    const got = await $fetch<{ fields: Record<string, unknown> }>(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const missing = REQUIRED_AIRTABLE_FIELDS.filter((field) =>
      isFieldEmpty(got.fields?.[field]),
    );
    const airtableUrl = buildAirtableRecordUrl(recordId);
    if (missing.length > 0) {
      return { state: "missing_fields", recordId, airtableUrl, missing };
    }
    return { state: "ok", recordId, airtableUrl };
  } catch (error) {
    return {
      state: "fetch_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Chunked OR(RECORD_ID()=...) lookups instead of one GET per record, which would burn
// Airtable's 5 req/s per-base rate limit.
export async function getAirtableRecordHealthBatch(
  recordIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, AirtableHealth>> {
  const out = new Map<string, AirtableHealth>();
  const validIds = Array.from(
    new Set(
      recordIds.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (validIds.length === 0) return out;

  const config = useRuntimeConfig();
  const token = config.airtableToken;
  if (!token) {
    for (const id of validIds) {
      out.set(id, { state: "fetch_failed", error: "no AIRTABLE_TOKEN configured" });
    }
    return out;
  }

  const CHUNK = 10;
  const chunks: string[][] = [];
  for (let i = 0; i < validIds.length; i += CHUNK) {
    chunks.push(validIds.slice(i, i + CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      // Airtable formula strings escape single quotes by doubling them.
      const formula = chunk
        .map((id) => `RECORD_ID()='${id.replace(/'/g, "''")}'`)
        .join(",");
      const wrapped = `OR(${formula})`;
      try {
        return (
          await $fetch<{
            records: Array<{ id: string; fields: Record<string, unknown> }>;
          }>(
            `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              query: { filterByFormula: wrapped },
            },
          )
        ).records;
      } catch (err) {
        console.warn("[airtable] batch health fetch failed", err);
        return null;
      }
    }),
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const records = results[i];
    if (!records) {
      for (const id of chunk) {
        out.set(id, {
          state: "fetch_failed",
          error: "batch chunk failed",
        });
      }
      continue;
    }
    const found = new Map(records.map((r) => [r.id, r]));
    for (const id of chunk) {
      const rec = found.get(id);
      if (!rec) {
        // Deleted since the ships query, or the filter didn't match.
        out.set(id, { state: "no_record" });
        continue;
      }
      const missing = REQUIRED_AIRTABLE_FIELDS.filter((field) =>
        isFieldEmpty(rec.fields?.[field]),
      );
      const airtableUrl = buildAirtableRecordUrl(id);
      if (missing.length > 0) {
        out.set(id, { state: "missing_fields", recordId: id, airtableUrl, missing });
      } else {
        out.set(id, { state: "ok", recordId: id, airtableUrl });
      }
    }
  }
  return out;
}

// No IO, so safe for non-server callers.
export function airtableRecordUrl(recordId: string): string {
  return buildAirtableRecordUrl(recordId);
}
