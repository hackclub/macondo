// The wire layer lives in ari-payload.ts (no Nuxt or db deps) so scripts can reuse it under plain bun.

import { useRuntimeConfig } from "#imports";
import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import db from "../db";
import {
  currencyTransactionTable,
  journalsTable,
  projectCollaboratorTable,
  projectTable,
  shipTable,
  users,
} from "../db/schema";
import { AriUnreachableError, buildAriShipPayload, postAriIngest, type AriIngestConfig, type AriJournalInput, type AriPersonInput, type AriSubmitResult } from "./ari-payload";
import { fetchOtherYswsHoursForShip } from "./airtable";
import {
  shipCountsAsUnifiedUpdate,
  type UnifiedYswsMatch,
} from "./cross-ysws-dedup";
import { buildTutorialCreditJournal } from "./tutorial-bonus";
import { getAgedOutJustification } from "../policies/projects";

export { AriUnreachableError } from "./ari-payload";
export type { AriSubmitResult } from "./ari-payload";

// Ships that can't meet ARI's hard payload requirements are recorded as skipped_<reason>
// instead of POSTing a guaranteed 422.
export type AriPushOutcome =
  | AriSubmitResult
  | { ok: false; status: "skipped"; reason: string };

// Lazy so the module imports without a Nuxt context; missing config throws AriUnreachableError
// so callers degrade the same way as an unreachable host.
function ariIngestConfig(): AriIngestConfig & { collaborative: boolean } {
  const config = useRuntimeConfig();
  const programId = (config.ariProgramId as string) || "";
  const ingestSecret = (config.ariIngestSecret as string) || "";
  if (!programId || !ingestSecret) {
    throw new AriUnreachableError(
      "NUXT_ARI_PROGRAM_ID / NUXT_ARI_INGEST_SECRET are not configured",
    );
  }
  return {
    baseUrl: (config.ariBaseUrl as string) || "https://webhooks.ari.hackclub.com",
    programId,
    ingestSecret,
    collaborative: String(config.ariCollaborative) === "true",
  };
}

// ARI runs its own double-dip check; this adds Macondo's view (incl. self matches) as context.
function dedupSummary(matches: UnifiedYswsMatch[]): string {
  return matches
    .map((m) => {
      const date = m.firstSubmittedAt?.toISOString().slice(0, 10) ?? "unknown date";
      const tags = [m.isSelf ? "self" : null, m.inWindow ? null : "pre-window"]
        .filter(Boolean)
        .join(", ");
      return `${m.ysws}: ${m.field} match, ${m.hours}h credited, approved ${date}${tags ? ` (${tags})` : ""}`;
    })
    .join("; ");
}

/** Does NOT write the ari_* columns; pushShipToAriAndRecord composes both and never throws. */
export async function submitShipToAri(
  shipId: number,
  opts: { backdate?: boolean } = {},
): Promise<AriPushOutcome> {
  const cfg = ariIngestConfig();

  const [ship] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.id, shipId))
    .limit(1);
  if (!ship) return { ok: false, status: "skipped", reason: "ship_not_found" };

  // A shipped ship has a final decision. Keyed on this ship's status, so a new update ship still pushes.
  if (ship.status === "shipped" || ship.status === "shipped_missing_airtable") {
    return { ok: false, status: "skipped", reason: "already_shipped" };
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);
  if (!project) return { ok: false, status: "skipped", reason: "project_not_found" };

  const [owner] = await db
    .select({
      email: users.email,
      name: users.name,
      slackId: users.slack_id,
      hackatimeId: users.hackatime_id,
    })
    .from(users)
    .where(eq(users.id, ship.user_id))
    .limit(1);
  if (!owner) return { ok: false, status: "skipped", reason: "owner_not_found" };

  const linkedJournalIds = ship.linked_journals ?? [];
  const journalRows = linkedJournalIds.length
    ? await db
        .select({
          at: journalsTable.created_at,
          hours: journalsTable.hours,
          title: journalsTable.short_brief,
          body: journalsTable.long_brief,
          authorEmail: users.email,
        })
        .from(journalsTable)
        .innerJoin(users, eq(users.id, journalsTable.user_id))
        .where(
          and(
            inArray(journalsTable.id, linkedJournalIds),
            eq(journalsTable.archived, false),
          ),
        )
        .orderBy(asc(journalsTable.created_at), asc(journalsTable.id))
    : [];
  const journals: AriJournalInput[] = journalRows.map((j) => ({
    at: j.at,
    hours: j.hours,
    title: j.title,
    body: j.body,
    authorEmail: j.authorEmail,
  }));

  // The tutorial runs in the browser so Hackatime can't track it, and ARI ignores the meta hours
  // string; send its +1h credit as a labeled synthetic devlog so the ship isn't rejected.
  const [earliestShip] = await db
    .select({ id: shipTable.id })
    .from(shipTable)
    .where(eq(shipTable.project_id, project.id))
    .orderBy(asc(shipTable.id))
    .limit(1);
  const tutorialJournal = buildTutorialCreditJournal({
    projectGuide: project.guide,
    shipId: ship.id,
    earliestShipId: earliestShip?.id ?? null,
    at: ship.created_at,
    authorEmail: owner.email,
  });
  if (tutorialJournal) journals.push(tutorialJournal);

  // A non-collaborative ARI program 422s on this field. ARI treats the list as the makers, so the owner leads.
  let collaborators: AriPersonInput[] | null = null;
  if (cfg.collaborative) {
    const others = (
      await db
        .select({
          email: users.email,
          name: users.name,
          slackId: users.slack_id,
          hackatimeId: users.hackatime_id,
        })
        .from(projectCollaboratorTable)
        .innerJoin(users, eq(users.id, projectCollaboratorTable.user_id))
        .where(
          and(
            eq(projectCollaboratorTable.project_id, project.id),
            eq(projectCollaboratorTable.status, "active"),
          ),
        )
    ).filter(
      (c) => c.email.toLowerCase() !== owner.email.toLowerCase(),
    );
    if (others.length > 0) collaborators = [owner, ...others];
  }

  // Fail-open: a dead Airtable must never block the push (ARI runs its own ledger check).
  const dedup = await fetchOtherYswsHoursForShip(
    project.repository_url ?? null,
    project.demo_url ?? null,
    { includeOutOfWindow: true, includeSelf: true },
  ).catch(() => ({ deduction: 0, matches: [] as UnifiedYswsMatch[] }));

  // For aged-out makers ship.hackatime_hours is capped to pre-19 work; this tells ARI why it's low.
  const agedOutJustification = await getAgedOutJustification(
    ship.user_id,
    project.id,
  );

  // ARI only floors an update's evidence window past a prior ARI approval, so Macondo-era approvals
  // would be re-credited; _prior_credited_at below hands ARI that boundary.
  const [priorApprovedShip] = await db
    .select({ createdAt: shipTable.created_at })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.project_id, project.id),
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        ne(shipTable.id, ship.id),
        lt(shipTable.created_at, ship.created_at ?? new Date()),
      ),
    )
    .orderBy(desc(shipTable.created_at))
    .limit(1);

  // Build proof is the only thing that unlocks pending gold, so tell the reviewer the stakes.
  // Mirrors the unlock predicate in finalize-ship-approval.ts so the amount matches.
  const pendingGoldRows = ship.is_build_complete_submission
    ? await db
        .select({ amount: currencyTransactionTable.amount })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.pending_for_project_id, project.id),
            isNull(currencyTransactionTable.unlocked_at),
            eq(currencyTransactionTable.counts, true),
          ),
        )
    : [];
  const pendingGoldTotal = pendingGoldRows.reduce((sum, r) => sum + r.amount, 0);

  const built = buildAriShipPayload({
    projectId: project.id,
    maker: owner,
    title: project.name,
    description: project.description,
    repoUrl: project.repository_url,
    demoUrl: project.demo_url,
    thumbnailUrl: project.thumbnail_url,
    track: project.type === "hardware" ? "hardware" : "software",
    hackatimeProjects: ship.hackatime_projects ?? [],
    journals,
    collaborators,
    // Mirrors the submit-time unified-dedup gate in ship.post.ts, so pre-Macondo credit flags as an update.
    isUpdate: shipCountsAsUnifiedUpdate({
      hasPriorShippedMacondoShip: ship.is_update,
      unifiedMatchCount: dedup.matches.length,
    }),
    // update_description is only snapshotted when is_update was true at submit; a cross-YSWS first
    // ship keeps its text on the project draft.
    updateDescription:
      ship.update_description || project.next_ship_update_description || null,
    shippedAt: opts.backdate ? (ship.created_at ?? null) : null,
    meta: {
      macondo_ship_id: String(ship.id),
      macondo_project_url: `https://macondo.hackclub.com/projects/${project.id}`,
      macondo_level: project.level,
      macondo_track: project.type,
      macondo_hackatime_hours:
        ship.hackatime_hours != null ? String(ship.hackatime_hours) : null,
      macondo_used_ai: ship.used_ai ? "true" : "false",
      macondo_ai_usage: ship.used_ai ? ship.ai_usage_description : null,
      macondo_funding_requested: ship.needs_funding ? "true" : "false",
      macondo_funding_amount_usd:
        ship.needs_funding && ship.needs_funding_amount_cents != null
          ? (ship.needs_funding_amount_cents / 100).toFixed(2)
          : null,
      // Gated on hardware: the column isn't cleared when a project switches to software.
      macondo_cart_screenshots:
        project.type === "hardware" ? (project.cart_screenshots ?? null) : null,
      macondo_build_complete: ship.is_build_complete_submission
        ? pendingGoldTotal > 0
          ? `true. Build proof for an already funded build, not a fresh submission. Approving unlocks ${pendingGoldTotal} gold the maker already earned on the funding ship, which stays locked until the build is proven. Requesting changes leaves it locked.`
          : "true. The maker says the hardware build is finished and the funded parts arrived."
        : null,
      macondo_reviewer_note: ship.reviewer_note,
      macondo_age_justification: agedOutJustification,
      macondo_cross_ysws_dedup: dedup.matches.length
        ? dedupSummary(dedup.matches)
        : null,
      // Reserved underscore key, hidden from reviewers: ARI floors the evidence window here.
      _prior_credited_at: priorApprovedShip?.createdAt
        ? priorApprovedShip.createdAt.toISOString()
        : null,
    },
  });
  if (!built.ok) return { ok: false, status: "skipped", reason: built.reason };

  const [currentShip] = await db
    .select({
      status: shipTable.status,
      ariSubmissionId: shipTable.ari_submission_id,
    })
    .from(shipTable)
    .where(eq(shipTable.id, shipId))
    .limit(1);
  if (!currentShip) {
    return { ok: false, status: "skipped", reason: "ship_not_found" };
  }
  if (currentShip.ariSubmissionId) {
    return { ok: false, status: "skipped", reason: "already_bound" };
  }
  if (
    currentShip.status !== "under_review" &&
    currentShip.status !== "pending_second_pass"
  ) {
    return { ok: false, status: "skipped", reason: "no_longer_in_review" };
  }

  return await postAriIngest(cfg, built.payload);
}

export async function recordAriPushOutcome(
  shipId: number,
  outcome: AriPushOutcome,
): Promise<void> {
  const now = new Date();
  if (outcome.ok) {
    await db
      .update(shipTable)
      .set({
        ari_submission_id: outcome.id,
        ari_status: outcome.status,
        ari_synced_at: now,
      })
      .where(eq(shipTable.id, shipId));
    return;
  }
  if (outcome.status === "already_queued") {
    await db
      .update(shipTable)
      .set({
        ...(outcome.id ? { ari_submission_id: outcome.id } : {}),
        ari_status: "already_queued",
        ari_synced_at: now,
      })
      .where(eq(shipTable.id, shipId));
    return;
  }
  // Writing ari_status here would clobber the ship's final (often ARI-approved) decision.
  if (outcome.status === "skipped" && outcome.reason === "already_shipped") {
    return;
  }
  const status =
    outcome.status === "invalid_payload"
      ? `invalid_payload:${outcome.field ?? "unknown"}`
      : `skipped_${outcome.reason}`;
  await db
    .update(shipTable)
    .set({ ari_status: status.slice(0, 200) }) // cap stored status length
    .where(eq(shipTable.id, shipId));
}

/** Swallows every error: an unreachable or misconfigured ARI must never affect ship submission. */
export async function pushShipToAriAndRecord(
  shipId: number,
  opts: { backdate?: boolean } = {},
): Promise<AriPushOutcome | null> {
  try {
    const outcome = await submitShipToAri(shipId, opts);
    await recordAriPushOutcome(shipId, outcome);
    if (!outcome.ok) {
      console.warn(
        `[ari] ship ${shipId} not queued: ${outcome.status}${
          "reason" in outcome ? ` (${outcome.reason})` : ""
        }`,
      );
    }
    return outcome;
  } catch (err) {
    const unreachable = err instanceof AriUnreachableError;
    console.warn(
      `[ari] push failed for ship ${shipId}:`,
      err instanceof Error ? err.message : err,
    );
    try {
      await db
        .update(shipTable)
        .set({ ari_status: unreachable ? "unreachable" : "error" })
        .where(eq(shipTable.id, shipId));
    } catch {
      // Best-effort status write; the submit flow must never see this fail.
    }
    return null;
  }
}
