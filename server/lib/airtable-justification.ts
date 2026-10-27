// Kept free of `#imports` and `server/db` so it loads under `bun test`.

import type { UnifiedYswsMatch } from "./cross-ysws-dedup";
import type { AriMinutesBreakdown } from "../types/ari";

function getPublicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// ARI provenance lines are dropped; [REVIEWED BY] already attributes the decision.
function stripAriProvenance(notes: string): string {
  return notes
    .split("\n")
    .filter(
      (line) =>
        !/^Decision delivered by ARI \(submission /.test(line.trim()) &&
        !/^ARI reviewer: /.test(line.trim()),
    )
    .join("\n")
    .trim();
}

// M/D/YYYY per the YSWS handbook, in UTC because Hackatime buckets by UTC day.
function handbookDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

// Null on an unknown end so we never report a range nothing was analyzed over.
export function formatEvidenceWindow(
  start: Date | null | undefined,
  end: Date | null | undefined,
): string | null {
  if (!end) return null;
  if (!start) return `up to ${handbookDate(end)}`;
  return `${handbookDate(start)}-${handbookDate(end)}`;
}

export function formatJustificationTemplate(opts: {
  shipId: number;
  projectId: number;
  decisionAuditNotes: string | null;
  overrideReason: string | null;
  reviewerName: string;
  reviewedAt: Date | null;
  // Non-null only when the owner turned 19 before this sync.
  agedOutNote?: string | null;
  isUpdateShip?: boolean;
  previousShipId?: number | null;
  cumulativeHours?: number;
  previousCumulativeHours?: number;
  deltaHours?: number;
  updateDescription?: string | null;
  updateSummary?: string | null;
  // REPORTED ONLY: never subtracted; the Unified reviewer makes the double-credit call.
  crossYswsCreditedElsewhere?: number;
  crossYswsMatches?: UnifiedYswsMatch[];
  // Mirrors UnifiedYswsLookupResult["skippedReason"] in airtable.ts; inlined to avoid its db imports.
  crossYswsSkippedReason?: "no-token" | "no-base" | "no-urls" | "fetch-failed";
  // trustScore is 1-10. The upstream API doesn't expose the fraud reviewer's name.
  fraudTrustScore?: number | null;
  fraudJustification?: string | null;
  fraudReviewedAt?: Date | null;
  // hackatimeHours is the RAW submit-time total, before reviewer deflation (that lives in ship.override_hours).
  hackatimeUserId?: number | null;
  hackatimeProjects?: string[] | null;
  hackatimeHours?: number | null;
  // Group rows only: rendered as an explicit line so the row never reads as having no Hackatime evidence.
  hackatimeUnavailable?: boolean;
  // journalHoursRaw is student-claimed (before deflation); journalHoursApproved is what the reviewer credited.
  journalHoursRaw?: number | null;
  journalHoursApproved?: number | null;
  // Update ships start at the previous shipped ship, first ships at the Macondo hours window start.
  // ARI's own range in ariHackatimeProjects wins when present.
  evidenceWindowStart?: Date | null;
  evidenceWindowEnd?: Date | null;
  // null when commits couldn't be fetched, so the block is skipped rather than claiming zero.
  // commitsTruncated marks the 300-commit fetch ceiling.
  commitCount?: number | null;
  commitsTruncated?: boolean;
  firstCommitAt?: string | null;
  lastCommitAt?: string | null;
  // Verbatim from ARI's inbound webhook; absent on natively-reviewed ships and pre-2026-07-27 ARI decisions.
  ariHackatimeProjects?: string | null;
  ariHackatimeUserId?: string | null;
  ariLapseLinks?: string | null;
  // Group rows only: the ARI payload predates per-collaborator lapse_links, so the list covers the whole ship.
  ariLapseLinksWholeShip?: boolean;
  ariTechnicalFeatures?: string | null;
  ariDeflationReason?: string | null;
  // Present only when the reviewer filled that prompt in.
  ariTimeEvidence?: string | null;
  ariSupportingEvidence?: string | null;
  ariHoursReasoning?: string | null;
  ariAdditionalJustification?: string | null;
  // ARI's ready-to-paste Unified DB write-up for hardware decisions with settled hours.
  ariUnifiedDbRecord?: string | null;
  // creditedHours is the ship's approved total; pushedHours is this row's after update delta and cross-YSWS dedup.
  creditedHours?: number | null;
  pushedHours?: number | null;
  ariMinutesBreakdown?: AriMinutesBreakdown | null;
  // Evidence of experience rather than a label, since a label we cannot defend is worse than none.
  priorApprovedShips?: number | null;
  firstApprovedShipAt?: Date | null;
  projectLevel?: string | null;
  // The handbook demands a statement either way; silence reads as an unexamined approval.
  wasDeflated?: boolean;
  // memberEmail is the maker THIS row pays; null on a solo ship.
  groupProject?: {
    memberEmail: string;
    memberHours: number;
    others: Array<{ email: string; hours: number }>;
  } | null;
}): string {
  const base = getPublicBaseUrl();

  const parts: string[] = [];

  // Machine-greppable so a URL-dedup pass doesn't fine the maker for an update sharing the original's Code URL.
  if (opts.isUpdateShip) {
    parts.push(
      `[UPDATE SHIP - NOT A DUPLICATE] This is an update of project ${opts.projectId} (previous ship #${opts.previousShipId ?? "?"}). The same Code URL on more than one Unified row for this project is expected update-ship behavior, not a duplicate submission.`,
    );
    parts.push("");
  }

  // One row per member shares the Code URL, so this needs the same not-a-duplicate marker.
  const group = opts.groupProject;
  if (group) {
    parts.push(
      `[GROUP PROJECT - NOT A DUPLICATE] Project ${opts.projectId} was built by ${group.others.length + 1} makers together. Each maker has their own Unified row for this ship, all sharing this Code URL; that is expected group-project behavior, not a duplicate submission.`,
    );
    parts.push(
      `This row credits ${group.memberEmail} with ${group.memberHours}h, their own contribution to the project.`,
    );
    parts.push(
      `Other makers on this project: ${group.others
        .map((o) => `${o.email} (${o.hours}h, on their own row)`)
        .join(", ")}.`,
    );
    parts.push("");
  }

  parts.push("[REVIEWER JUSTIFICATION]");
  parts.push(stripAriProvenance(opts.decisionAuditNotes ?? "") || "(none provided)");

  if (opts.ariTechnicalFeatures?.trim()) {
    parts.push("");
    parts.push("[SPECIFIC TECHNICAL FEATURES]");
    parts.push(opts.ariTechnicalFeatures.trim());
  }

  if (opts.ariTimeEvidence?.trim()) {
    parts.push("");
    parts.push("[TIME EVIDENCE]");
    parts.push(opts.ariTimeEvidence.trim());
  }

  if (opts.ariSupportingEvidence?.trim()) {
    parts.push("");
    parts.push("[SUPPORTING EVIDENCE]");
    parts.push(opts.ariSupportingEvidence.trim());
  }

  if (opts.ariHoursReasoning?.trim()) {
    parts.push("");
    parts.push("[HOURS REASONING]");
    parts.push(opts.ariHoursReasoning.trim());
  }

  if (opts.ariAdditionalJustification?.trim()) {
    parts.push("");
    parts.push("[ADDITIONAL JUSTIFICATION]");
    parts.push(opts.ariAdditionalJustification.trim());
  }

  if (opts.overrideReason?.trim()) {
    parts.push("");
    parts.push("[HOURS OVERRIDE NOTES]");
    parts.push(opts.overrideReason.trim());
  }

  // ARI's mandatory deflation rationale, distinct from the Macondo reviewer's override note above.
  if (opts.ariDeflationReason?.trim()) {
    parts.push("");
    parts.push("[DEFLATION JUSTIFICATION]");
    parts.push(opts.ariDeflationReason.trim());
  }

  // Placed high so audits see the age carve-out before comparing hours to raw Hackatime totals.
  if (opts.agedOutNote?.trim()) {
    parts.push("");
    parts.push("[AGED OUT MAKER]");
    parts.push(opts.agedOutNote.trim());
  }

  if (opts.isUpdateShip) {
    parts.push("");
    parts.push("[UPDATE SHIP]");
    parts.push(
      `This is an update ship for project ${opts.projectId}. Previous ship #${opts.previousShipId ?? "?"} already accounted for ${opts.previousCumulativeHours ?? 0}h.`,
    );
    parts.push(
      `Current cumulative: ${opts.cumulativeHours ?? 0}h. Delta pushed to Airtable: ${opts.deltaHours ?? 0}h.`,
    );
    if (opts.updateDescription?.trim()) {
      parts.push("");
      parts.push("Student description of what changed:");
      parts.push(opts.updateDescription.trim());
    }
    if (opts.updateSummary?.trim()) {
      parts.push("");
      parts.push("[AI SUMMARY OF UPDATES]");
      parts.push(opts.updateSummary.trim());
    }
  }

  if (opts.fraudTrustScore != null) {
    parts.push("");
    parts.push("[FRAUD REVIEW]");
    parts.push(
      `Reviewed by the YSWS Fraud team. Trust score ${opts.fraudTrustScore}/10 (must be >4 to return to the queue).`,
    );
    if (opts.fraudReviewedAt) {
      parts.push(`Reviewed at: ${opts.fraudReviewedAt.toISOString()}`);
    }
    if (opts.fraudJustification?.trim()) {
      parts.push("Justification:");
      parts.push(opts.fraudJustification.trim());
    }
  }

  if (opts.crossYswsMatches && opts.crossYswsMatches.length > 0) {
    parts.push("");
    parts.push("[UPDATE - DUPLICATE CODE URL]");
    parts.push(
      `UPDATE: this code URL was already submitted under another YSWS program. This submission is an UPDATE of an existing unified-DB record, not a fresh entry. Found ${opts.crossYswsMatches.length} matching record(s) under other YSWS programs.`,
    );

    parts.push(
      `Hours already credited under those programs (in-window): ${opts.crossYswsCreditedElsewhere ?? 0}h. These are NOT subtracted from the hours pushed here: the reviewer of record assessed this submission on its own evidence, so the double-credit call is yours.`,
    );

    for (const m of opts.crossYswsMatches) {
      const when = m.firstSubmittedAt
        ? m.firstSubmittedAt.toISOString().split("T")[0]
        : "unknown";
      parts.push(
        `\u26a0 FLAG ${m.recordId}  ${m.ysws}  ${m.field}=${m.url}  firstSubmittedAt=${when}  hours=${m.hours}`,
      );
    }

    // A first Macondo ship that duplicates another YSWS has isUpdateShip=false, so [UPDATE SHIP] didn't render this.
    if (!opts.isUpdateShip && opts.updateDescription?.trim()) {
      parts.push("");
      parts.push("Student description of what changed:");
      parts.push(opts.updateDescription.trim());
    }
  }

  // These hours are RAW Hackatime, not reviewer-deflated (that is ship.override_hours).
  const hackatimeUserId = opts.hackatimeUserId ?? opts.ariHackatimeUserId ?? null;
  const hasHackatimeUser =
    hackatimeUserId != null && String(hackatimeUserId).trim() !== "";
  // ARI's string carries the range the hours were settled against; the derived window only approximates it.
  const ariProjects = opts.ariHackatimeProjects?.trim() || null;
  const hasHackatimeProjects =
    ariProjects != null ||
    (Array.isArray(opts.hackatimeProjects) && opts.hackatimeProjects.length > 0);
  const hasHackatimeHours =
    typeof opts.hackatimeHours === "number" && opts.hackatimeHours >= 0;
  const hackatimeUnavailable = !!group && opts.hackatimeUnavailable === true;
  if (
    hasHackatimeUser ||
    hasHackatimeProjects ||
    hasHackatimeHours ||
    hackatimeUnavailable
  ) {
    parts.push("");
    parts.push("[HACKATIME]");
    // Every figure here is this maker's own account, never the owner's.
    if (group) {
      parts.push(
        `Scope: ${group.memberEmail}'s own Hackatime account only; each maker's row cites their own.`,
      );
    }
    if (hasHackatimeUser) {
      parts.push(`User Hackatime ID: ${hackatimeUserId}`);
      parts.push(
        `Heartbeats: https://hackatime.hackclub.com/?user=${hackatimeUserId}`,
      );
    }
    if (hasHackatimeProjects) {
      parts.push(
        `Projects: ${ariProjects ?? opts.hackatimeProjects!.join(", ")}`,
      );
    }
    // Only when ARI didn't stamp a range on each project, so there are never two differently-derived windows.
    if (!ariProjects) {
      const window = formatEvidenceWindow(
        opts.evidenceWindowStart,
        opts.evidenceWindowEnd,
      );
      if (window) parts.push(`Analyzed over: ${window}`);
    }
    if (hasHackatimeHours) {
      parts.push(
        `Raw Hackatime hours (BEFORE reviewer deflation): ${opts.hackatimeHours}h`,
      );
    } else if (hackatimeUnavailable) {
      parts.push(
        "Raw Hackatime hours for this maker could not be fetched at sync time (Hackatime not linked, or the lookup failed); the admin review link below shows the live per-maker breakdown.",
      );
    }
  }

  // Skipped when the fetch failed, so an unreadable repo doesn't read as zero commits.
  if (opts.commitCount != null) {
    parts.push("");
    parts.push("[COMMIT HISTORY]");
    const window = formatEvidenceWindow(
      opts.evidenceWindowStart,
      opts.evidenceWindowEnd,
    );
    parts.push(
      `${opts.commitCount}${opts.commitsTruncated ? "+" : ""} commit(s)${window ? ` over ${window}` : ""}.` +
        (opts.commitsTruncated
          ? " Count is capped at the 300-commit fetch ceiling; the true total is higher."
          : ""),
    );
    if (opts.firstCommitAt && opts.lastCommitAt) {
      parts.push(`First: ${opts.firstCommitAt}  Last: ${opts.lastCommitAt}`);
    }
  }

  // Macondo stores no lapse URLs of its own, so ARI's list is the only source.
  if (opts.ariLapseLinks?.trim()) {
    parts.push("");
    parts.push("[TIMELAPSES]");
    if (group) {
      parts.push(
        opts.ariLapseLinksWholeShip
          ? "Whole-ship list: this decision predates ARI's per-maker timelapse split, so these cover every maker on the ship."
          : `Scope: ${group.memberEmail}'s own timelapses only.`,
      );
    }
    for (const link of opts.ariLapseLinks.split(",")) {
      const url = link.trim();
      if (url) parts.push(url);
    }
  }

  if (opts.priorApprovedShips != null || opts.projectLevel) {
    parts.push("");
    parts.push("[SUBMITTER EXPERIENCE]");
    if (opts.priorApprovedShips != null) {
      parts.push(
        opts.priorApprovedShips === 0
          ? "First approved ship on Macondo."
          : `${opts.priorApprovedShips} previously approved ship(s) on Macondo` +
              (opts.firstApprovedShipAt
                ? `, first on ${handbookDate(opts.firstApprovedShipAt)}.`
                : "."),
      );
    }
    if (opts.projectLevel) {
      parts.push(
        `Difficulty level selected for this project: ${opts.projectLevel} (1 = beginner, 4 = expert).`,
      );
    }
  }

  if (opts.journalHoursRaw != null) {
    parts.push("");
    parts.push("[JOURNAL HOURS]");
    if (group) {
      parts.push(`Scope: ${group.memberEmail}'s own journals only.`);
    }
    parts.push(
      `Raw journal hours claimed (BEFORE reviewer deflation): ${opts.journalHoursRaw}h`,
    );
    if (opts.journalHoursApproved != null) {
      parts.push(
        `Approved journal hours (AFTER reviewer deflation): ${opts.journalHoursApproved}h`,
      );
    }
  }

  if (opts.creditedHours != null || opts.pushedHours != null) {
    parts.push("");
    parts.push("[HOURS CREDITED]");
    if (opts.creditedHours != null) {
      parts.push(`Approved on this ship (cumulative): ${opts.creditedHours}h`);
    }
    if (opts.pushedHours != null) {
      parts.push(
        `Pushed to this Unified row (after update delta and cross-YSWS dedup): ${opts.pushedHours}h`,
      );
    }
    const b = opts.ariMinutesBreakdown;
    if (b) {
      const sources = (
        [
          ["Hackatime", b.hackatime],
          ["journals", b.journals],
          ["timelapse", b.lapse],
          ["program-added", b.program],
        ] as const
      )
        .filter(([, m]) => typeof m === "number" && m > 0)
        .map(
          ([label, m]) => `${label} ${Math.round((m! / 60) * 100) / 100}h`,
        );
      if (sources.length) {
        // On a group row this is ARI's per-collaborator breakdown, so it agrees with the credited figure.
        parts.push(
          `Evidence sources${group ? " (this maker)" : ""}: ${sources.join(", ")}.`,
        );
      }
    }
    if (opts.wasDeflated === false && !opts.ariDeflationReason?.trim()) {
      parts.push(
        "No deflation applied: the hours credited are the full evidence captured.",
      );
    }
  }

  // Verbatim even if it repeats facts above: it is ARI's canonical write-up.
  if (opts.ariUnifiedDbRecord?.trim()) {
    parts.push("");
    parts.push("[ARI UNIFIED DB RECORD]");
    parts.push(opts.ariUnifiedDbRecord.trim());
  }

  parts.push("");
  parts.push("[REVIEWED BY]");
  parts.push(
    `${opts.reviewerName} at ${opts.reviewedAt ? opts.reviewedAt.toISOString() : "unknown"}`,
  );

  parts.push("");
  parts.push("[LINKS]");
  parts.push(`Project page: ${base}/projects/${opts.projectId}`);
  // #journal anchor isn't wired in the SPA, but the Journal section is always visible.
  parts.push(`Journals: ${base}/projects/${opts.projectId}#journal`);
  parts.push(`Admin project: ${base}/internal/projects/${opts.projectId}`);

  return parts.join("\n");
}
