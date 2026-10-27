// ARI redelivers up to 4 times, so processing must be idempotent: the advisory record is written
// AFTER the status-guarded consequences, so redeliveries re-run them as no-ops or hit the dedup.

import { useRuntimeConfig } from "#imports";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import db from "../db";
import { projectTable, shipTable, users } from "../db/schema";
import type { AriInboundCollaborator, AriInboundEvent } from "../types/ari";
import { ariOutboundSignatureMatches } from "./ari-signature";
import { isAriAuthoritative } from "./app-settings";
import { writeAudit } from "./audit";
import { notify } from "./notify";
import { postMessage } from "./slack-bot";
import { markShipRejected } from "./review-actions";
import { buildApproveSnapshot } from "./ship-approve-snapshot";
import { finalizeShipApproval } from "./finalize-ship-approval";
import { revertShipApproval } from "./revert-ship";
import {
  getApprovedJournalHoursForShip,
  getReviewFlow,
  shipHasLinkedHackatimeProjects,
} from "./review";
import { parseAriLevelOverride } from "./ari-level-override";

type Ship = InferSelectModel<typeof shipTable>;

const KNOWN_EVENTS = new Set<string>([
  "ship.updated",
  "review.approved",
  "review.changes",
  "review.rejected",
  "review.reverted",
  "review.requeued",
]);

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// A signed delivery failing verification is a real ARI decision being dropped, so alert loudly.
// Module state is enough since Macondo runs a single replica.
const SIG_ALERT_COOLDOWN_MS = 15 * 60_000;
let sigFailWindowStart = 0;
let sigFailCount = 0;
let sigFailLastAlertAt = 0;

export function recordAriSignatureRejection(): void {
  const now = Date.now();
  if (now - sigFailWindowStart > SIG_ALERT_COOLDOWN_MS) {
    sigFailWindowStart = now;
    sigFailCount = 0;
  }
  sigFailCount += 1;
  if (now - sigFailLastAlertAt < SIG_ALERT_COOLDOWN_MS) return;
  sigFailLastAlertAt = now;
  const count = sigFailCount;
  const mins = Math.round(SIG_ALERT_COOLDOWN_MS / 60_000); // ms to minutes
  void (async () => {
    try {
      const config = useRuntimeConfig();
      await postMessage({
        channel:
          (config.reviewSlackChannelId as string | undefined)?.trim() || "C0AVA80N0S0",
        text:
          `:rotating_light: Macondo rejected ${count} ARI webhook ` +
          `${count === 1 ? "delivery" : "deliveries"} with an INVALID SIGNATURE in the ` +
          `last ~${mins} min. ARI's outbound signing secret likely no longer matches ` +
          `\`NUXT_ARI_WEBHOOK_SECRET\`, so review decisions are being DROPPED (they land ` +
          `as FAILED on ARI and never reach Macondo). Check the ARI program's outbound ` +
          `webhook secret against Macondo's, then re-send the missed decisions from ARI's ` +
          `reviewed-history page.`,
      });
    } catch (e) {
      console.error("[ari-inbound] failed to post signature-rejection alert", e);
    }
  })();
}

/** Stripe-style HMAC over `${timestamp}.${deliveryId}.${rawBody}`; must run on the raw bytes before any JSON parse. */
export function verifyAriSignature(
  rawBody: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  deliveryId: string | null | undefined,
): boolean {
  const config = useRuntimeConfig();
  return ariOutboundSignatureMatches(
    config.ariWebhookSecret as string | undefined,
    rawBody,
    signature,
    timestamp,
    deliveryId,
  );
}

export function parseAriInboundEvent(raw: unknown): AriInboundEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.event !== "string" || !p.event.trim()) return null;
  if (typeof p.id !== "string" || !p.id.trim()) return null;
  if (typeof p.external_id !== "string" || !p.external_id.trim()) return null;
  if (p.event === "ship.updated") {
    // Metadata corrections carry a ship snapshot and change list instead of a review.
    if (typeof p.ship !== "object" || p.ship === null) return null;
    if (!Array.isArray(p.changes)) return null;
  } else if (typeof p.review !== "object" || p.review === null) {
    return null;
  }
  return p as unknown as AriInboundEvent;
}

export interface AriInboundOutcome {
  ok: true;
  result: string;
  shipId?: number;
  dedup?: boolean;
  applied?: boolean;
}

function fieldValue(payload: AriInboundEvent, key: string): unknown {
  return payload.review?.fields?.find((f) => f?.key === key)?.value ?? null;
}

function fieldBool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

function fieldNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function approvedHoursFromPayload(payload: AriInboundEvent): number | null {
  const h = payload.review?.approved_hours;
  if (typeof h === "number" && Number.isFinite(h)) return h;
  const m = payload.review?.approved_minutes;
  if (typeof m === "number" && Number.isFinite(m)) {
    return Math.round((m / 60) * 100) / 100; // minutes to hours, 2 decimals
  }
  return null;
}

function buildAriAuditNotes(payload: AriInboundEvent): string {
  const lines = [
    `Decision delivered by ARI (submission ${payload.id}, event ${payload.event}).`,
  ];
  const reviewerEmail = payload.review?.reviewer?.email;
  if (reviewerEmail) lines.push(`ARI reviewer: ${reviewerEmail}`);
  const note = payload.review?.audit_note?.trim();
  if (note) lines.push("", note);
  return lines.join("\n");
}

/** Null means audits are attributed to the ship owner, the convention for automated paths. */
async function resolveAriReviewerUserId(
  reviewer: { email: string; slack_id: string | null } | null | undefined,
): Promise<string | null> {
  if (!reviewer) return null;
  const email = reviewer.email?.trim().toLowerCase();
  if (email) {
    const [byEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (byEmail) return byEmail.id;
  }
  const slackId = reviewer.slack_id?.trim();
  if (slackId) {
    const [bySlack] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.slack_id, slackId))
      .limit(1);
    if (bySlack) return bySlack.id;
  }
  return null;
}

// The project fallback is the first-contact path that stamps the submission binding.
async function findShipForEvent(payload: AriInboundEvent): Promise<Ship | null> {
  const [byAriId] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.ari_submission_id, payload.id))
    .orderBy(desc(shipTable.id))
    .limit(1);
  if (byAriId) return byAriId;

  const projectId = Number(payload.external_id);
  if (!Number.isInteger(projectId) || projectId <= 0) return null;

  const isUndo = payload.event === "review.reverted" || payload.event === "review.requeued";
  const fallbackStatuses: Ship["status"][] = isUndo
    ? [
        "shipped",
        "shipped_missing_airtable",
        "pending_second_pass",
        "under_review",
        "pending_fraud_review",
        "needs_changes",
        "rejected",
      ]
    : ["under_review", "pending_fraud_review", "pending_second_pass", "needs_changes"];

  // Never grab a ship bound to a DIFFERENT submission: a zombie duplicate sharing externalId would
  // otherwise reject the live ship. Such events are orphans: log and ack, never apply.
  const [byProject] = await db
    .select()
    .from(shipTable)
    .where(
      and(
        eq(shipTable.project_id, projectId),
        inArray(shipTable.status, fallbackStatuses),
        or(
          isNull(shipTable.ari_submission_id),
          eq(shipTable.ari_submission_id, payload.id),
        ),
      ),
    )
    .orderBy(desc(shipTable.id))
    .limit(1);
  return byProject ?? null;
}

async function mapCollaboratorHours(
  collaborators: AriInboundCollaborator[] | undefined,
): Promise<Array<{ user_id: string; approved_hours: number }> | null> {
  if (!collaborators?.length) return null;
  const out: Array<{ user_id: string; approved_hours: number }> = [];
  for (const c of collaborators) {
    const hours =
      typeof c.approved_hours === "number" && Number.isFinite(c.approved_hours)
        ? c.approved_hours
        : typeof c.approved_minutes === "number" && Number.isFinite(c.approved_minutes)
          ? c.approved_minutes / 60
          : null;
    if (hours === null || hours < 0) continue;
    const email = c.email?.trim().toLowerCase();
    if (!email) continue;
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    // Unknown emails are skipped; buildApproveSnapshot also ignores non-contributors.
    if (u) out.push({ user_id: u.id, approved_hours: Math.round(hours * 100) / 100 });
  }
  return out.length ? out : null;
}

// Personal notes go out as their own notification (the only channel for non-owner collaborators).
// Only called after a decision applied, so redeliveries can't double-send.
async function deliverPersonalReviewerNotes(
  ship: Ship,
  payload: AriInboundEvent,
): Promise<void> {
  const sharedNote = payload.review?.note_to_maker?.trim() ?? "";
  // A note identical to the shared one isn't personal.
  const personal = (payload.collaborators ?? [])
    .map((c) => ({
      email: c.email?.trim().toLowerCase(),
      note: c.note_to_maker?.trim(),
    }))
    .filter(
      (c): c is { email: string; note: string } =>
        Boolean(c.email) && Boolean(c.note) && c.note !== sharedNote,
    );
  if (personal.length === 0) return;

  const [project] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);
  const projectName = project?.name ?? "your project";
  const projectUrl = `${publicBaseUrl()}/projects/${ship.project_id}`;

  // Reuse the decision's notification type so prefs routing matches. Personal notes are reviewer-written,
  // so a softened system auto-reject never hits the rejected mapping.
  const type =
    payload.event === "review.approved"
      ? ("ship_approved" as const)
      : payload.event === "review.rejected"
        ? ("ship_rejected" as const)
        : ("ship_needs_changes" as const);

  for (const { email, note } of personal) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (!user) continue;
    void notify({
      user_id: user.id,
      type,
      title: `${projectName}: a note from your reviewer`,
      body: note,
      action_url: projectUrl,
      entity_type: "ship",
      entity_id: String(ship.id),
      slack: {
        text: `:speech_balloon: The reviewer of *${projectName}* left a note just for you:\n>${note}`,
      },
    });
  }
}

interface ApplyResult {
  applied: boolean;
  note: string;
  // Reviewer-correctable failure: respond non-2xx so ARI shows it FAILED, and skip the dedup
  // advisory so a corrected re-approval reprocesses.
  surface?: boolean;
}

// Applies only the fields the reviewer changed: untouched snapshot fields may be stale against
// later Macondo edits. author_names has no Macondo counterpart and is only audited.
async function applyAriShipUpdated(
  ship: Ship,
  payload: AriInboundEvent,
): Promise<ApplyResult> {
  const snap = payload.ship;
  const changed = new Set(
    (payload.changes ?? [])
      .map((c) => (typeof c?.field === "string" ? c.field : null))
      .filter((f): f is string => f !== null),
  );
  if (!snap || changed.size === 0) return { applied: false, note: "no_changes" };

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const projectSet: Partial<{
    name: string;
    description: string;
    type: "software" | "hardware";
    thumbnail_url: string | null;
    repository_url: string | null;
    demo_url: string | null;
  }> = {};
  const title = str(snap.title);
  if (changed.has("title") && title) projectSet.name = title;
  // projects.description is NOT NULL; a cleared ARI description becomes "".
  if (changed.has("description")) {
    projectSet.description = typeof snap.description === "string" ? snap.description : "";
  }
  if (changed.has("track") && (snap.track === "software" || snap.track === "hardware")) {
    projectSet.type = snap.track as "software" | "hardware";
  }
  if (changed.has("thumbnail_url")) projectSet.thumbnail_url = str(snap.thumbnail_url);
  if (changed.has("repo_url")) projectSet.repository_url = str(snap.repo_url);
  if (changed.has("demo_url")) projectSet.demo_url = str(snap.demo_url);

  // The project's own Hackatime linkage (which drives streaks) stays the maker's to manage.
  const shipHackatime =
    changed.has("hackatime_projects") && Array.isArray(snap.hackatime_projects)
      ? snap.hackatime_projects.filter((p) => typeof p === "string" && p.trim())
      : null;

  if (Object.keys(projectSet).length === 0 && shipHackatime === null) {
    return { applied: false, note: "no_mappable_changes" };
  }

  if (Object.keys(projectSet).length > 0) {
    await db
      .update(projectTable)
      .set({ ...projectSet, updated_at: new Date() })
      .where(eq(projectTable.id, ship.project_id));
  }
  if (shipHackatime !== null) {
    await db
      .update(shipTable)
      .set({ hackatime_projects: shipHackatime })
      .where(eq(shipTable.id, ship.id));
  }

  return { applied: true, note: `updated: ${[...changed].join(", ")}` };
}

async function applyAriApproval(
  ship: Ship,
  payload: AriInboundEvent,
  reviewerUserId: string | null,
  auditActorId: string,
): Promise<ApplyResult> {
  const hours = approvedHoursFromPayload(payload);
  if (!hours || hours <= 0) {
    // Nothing payable; leave the ship for manual handling rather than approve a 0h payout.
    return { applied: false, note: "zero_hours", surface: true };
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);
  if (!project) return { applied: false, note: "project_missing", surface: true };

  // Not persisted yet: the level and the reward must move together, so it's saved only after
  // buildApproveSnapshot succeeds (a 409 there would otherwise reclassify an already-paid project).
  const levelOverride = parseAriLevelOverride(
    project.level,
    fieldValue(payload, "macondo_level"),
  );

  // Custom review fields configured on the ARI program (docs/ari-setup.md); absent ones fall back to safe defaults.
  const fundedHours = fieldNumber(fieldValue(payload, "macondo_funded_hours"));
  const extraFruity = fieldBool(fieldValue(payload, "macondo_extra_fruity"));
  const revealIdentity = fieldBool(fieldValue(payload, "macondo_reveal_identity"));
  const contributorHours = await mapCollaboratorHours(payload.collaborators);

  // ARI's approved hours are credited verbatim, updates included: capping at Macondo's own
  // Hackatime delta silently zeroed approved payouts.
  let softwareOverride: number | undefined;
  if (
    getReviewFlow(project.type, {
      hasHackatimeProjects: shipHasLinkedHackatimeProjects(ship),
    }).hasSoftware
  ) {
    softwareOverride = Math.max(
      0,
      hours - (await getApprovedJournalHoursForShip(ship.id)),
    );
  }

  const snapshot = await buildApproveSnapshot({
    ship,
    project: levelOverride ? { ...project, level: levelOverride.newLevel } : project,
    finalApprovedHours: hours,
    actorId: reviewerUserId,
    auditNotes: buildAriAuditNotes(payload),
    userMessage: payload.review?.note_to_maker?.trim() || null,
    decisionAttachments: null,
    revealReviewerIdentity: revealIdentity,
    extraFruity,
    needsFundingHoursOverride: fundedHours,
    contributorHours,
    // Priority (event attendee) gold is locked to priority-eligible shop items.
    priorityPayout: payload.priority === true,
    // ARI's confirmation outranks a parked Macondo first-pass approval. Fraud review also lives in ARI.
    fromStatuses: ["under_review", "pending_fraud_review", "pending_second_pass"],
    extraSet:
      softwareOverride !== undefined
        ? { software_override_hours: softwareOverride }
        : undefined,
  });

  if (!snapshot.ok) {
    if (snapshot.statusCode === 409) {
      return { applied: false, note: "decision_conflict" };
    }
    // A 400 is reviewer-correctable (e.g. funded hours above approved), so surface it to ARI.
    return {
      applied: false,
      note: `snapshot_invalid: ${snapshot.message}`,
      surface: true,
    };
  }

  // finalizeShipApproval re-reads project.level for its memo, so persist before finalize.
  if (levelOverride) {
    await db
      .update(projectTable)
      .set({ level: levelOverride.newLevel, updated_at: new Date() })
      .where(eq(projectTable.id, project.id));
    try {
      await writeAudit({
        actor_id: auditActorId,
        action: "ari_level_override",
        entity_type: "project",
        entity_id: String(project.id),
        old_value: { level: project.level },
        new_value: {
          level: levelOverride.newLevel,
          via: "ari",
          ari_submission_id: payload.id,
        },
        sensitive: false,
        public_message: `Project level set to ${levelOverride.newLevel} by the ARI reviewer`,
        change_summary: project.name,
      });
    } catch (error) {
      console.error("[ari-inbound] audit write failed for level override", error);
    }
  }

  // ARI's program runs with secondPass=true, so finalize now; on failure the ship stays parked
  // in pending_second_pass for the supaadmin UI.
  const finalized = await finalizeShipApproval({
    shipId: ship.id,
    actorId: reviewerUserId ?? ship.user_id,
    // ari_last_event isn't persisted until this chain succeeds, so hand the payload to the Airtable sync.
    ariEvent: payload,
  });
  if (!finalized.ok) {
    return { applied: true, note: `parked_pending_second_pass: ${finalized.reason}` };
  }
  return {
    applied: true,
    note: `finalized: ${finalized.finalApprovedHours}h, ${finalized.goldReward} gold`,
  };
}

// Mirror of reverse-decision.post.ts.
async function resetDecisionToQueue(
  ship: Ship,
  reason: string,
  auditActorId: string,
): Promise<ApplyResult> {
  const [updated] = await db
    .update(shipTable)
    .set({
      status: "under_review",
      reviewed_at: null,
      decision_audit_notes: null,
      decision_user_message: null,
      decision_user_message_translations: null,
      first_pass_reviewer_id: null,
      first_pass_approved_at: null,
      first_pass_reveal_identity: false,
      second_pass_actioned_at: null,
      second_pass_gold_reward: null,
      second_pass_multiplier: null,
      second_pass_lifetime_fruit_delta: null,
      second_pass_assigned_fruit: null,
      second_pass_contributor_split: null,
      // Clear the reversed park's hours: the review UI treats a nonzero software override as
      // "software phase complete". For rejected/needs_changes they stay as prefill.
      ...(ship.status === "pending_second_pass"
        ? {
            override_hours: null,
            override_reason: null,
            software_override_hours: null,
            software_override_reason: null,
          }
        : {}),
      queue_entered_at: new Date(),
    })
    .where(
      and(
        eq(shipTable.id, ship.id),
        inArray(shipTable.status, ["rejected", "needs_changes", "pending_second_pass"]),
      ),
    )
    .returning();
  if (!updated) return { applied: false, note: "reset_conflict" };

  const [project] = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);

  try {
    await writeAudit({
      actor_id: auditActorId,
      action: "reverse_ship_review",
      entity_type: "ship",
      entity_id: String(ship.id),
      old_value: ship,
      new_value: updated,
      sensitive: false,
      public_message: `Ship review reversed via ARI requeue (back to under_review): ${reason}`,
      change_summary: project?.name ?? null,
    });
  } catch (e) {
    console.error("[ari-inbound] audit write failed for requeue reset", e);
  }

  // A pending_second_pass decision was never student-visible (the public API masks it).
  if (ship.status === "rejected" || ship.status === "needs_changes") {
    const projectName = project?.name ?? "your project";
    const projectUrl = project
      ? `${publicBaseUrl()}/projects/${project.id}`
      : publicBaseUrl();
    const prevLabel = ship.status === "rejected" ? "rejected" : "needing changes";
    void notify({
      user_id: ship.user_id,
      type: "ship_decision_reversed",
      title: `${projectName}: reviewer reversed the previous decision`,
      body: `Your ship was previously marked ${prevLabel}, but a reviewer has reversed that. It's back under review.`,
      action_url: projectUrl,
      entity_type: "ship",
      entity_id: String(ship.id),
      slack: {
        text: `:arrows_counterclockwise: Your ship for *${projectName}* was previously ${prevLabel}, but a reviewer reversed that. It's back in the queue.`,
      },
      email: {
        template: "ship_decision_reversed",
        data: {
          project_name: projectName,
          previous_status: ship.status,
          reason,
          project_url: projectUrl,
        },
      },
    });
  }

  return { applied: true, note: "decision_reversed" };
}

// Both claw back a paid ship; only a requeue puts an unpaid decided ship back on the queue.
async function applyAriUndo(
  ship: Ship,
  payload: AriInboundEvent,
  auditActorId: string,
  kind: "reverted" | "requeued",
): Promise<ApplyResult> {
  const reason =
    payload.review?.audit_note?.trim() ||
    payload.review?.note_to_maker?.trim() ||
    `ARI ${kind} (submission ${payload.id})`;

  if (ship.status === "shipped" || ship.status === "shipped_missing_airtable") {
    try {
      await revertShipApproval({
        shipId: ship.id,
        actorId: auditActorId,
        internalNotes: `ARI ${kind}: ${reason}`,
        publicNotes: payload.review?.note_to_maker?.trim() || null,
      });
      return { applied: true, note: "approval_reverted" };
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 409) {
        return { applied: false, note: "revert_conflict" };
      }
      // HCB refusals and unexpected errors bubble up so ARI retries and logs the failure.
      throw err;
    }
  }

  if (
    ship.status === "rejected" ||
    ship.status === "needs_changes" ||
    ship.status === "pending_second_pass"
  ) {
    if (kind === "requeued") {
      return await resetDecisionToQueue(ship, reason, auditActorId);
    }
    // Nothing was granted and ARI considers the submission closed.
    return { applied: false, note: `no_payout_to_revert: ${ship.status}` };
  }

  return { applied: false, note: `nothing_to_undo: ${ship.status}` };
}

/**
 * Drives the lifecycle only when ari_authoritative is on. Unknown ships and events ack
 * cleanly, since an error would only burn ARI's retries.
 */
export async function processAriInboundEvent(
  payload: AriInboundEvent,
): Promise<AriInboundOutcome> {
  if (!KNOWN_EVENTS.has(payload.event)) {
    return { ok: true, result: "ignored_unknown_event" };
  }

  const ship = await findShipForEvent(payload);
  if (!ship) {
    console.warn(
      `[ari-inbound] orphan event ${payload.event} for ARI submission ${payload.id} (external_id ${payload.external_id})`,
    );
    return { ok: true, result: "orphan" };
  }

  // Before the dedup: distinct metadata edits share the same triple, so dedup would swallow them.
  // Never touches ari_status / ari_last_event, which track the review lifecycle.
  if (payload.event === "ship.updated") {
    const actorId =
      (await resolveAriReviewerUserId(payload.edited_by)) ?? ship.user_id;
    const update = (await isAriAuthoritative())
      ? await applyAriShipUpdated(ship, payload)
      : { applied: false, note: "shadow" };

    // findShipForEvent guarantees the ship is unbound or already bound to this submission.
    await db
      .update(shipTable)
      .set({ ari_submission_id: payload.id })
      .where(eq(shipTable.id, ship.id));

    try {
      await writeAudit({
        actor_id: actorId,
        action: "ari_ship_updated",
        entity_type: "ship",
        entity_id: String(ship.id),
        new_value: {
          ari_submission_id: payload.id,
          edited_by: payload.edited_by?.email ?? null,
          changes: payload.changes ?? [],
          applied: update.applied,
          note: update.note,
        },
        sensitive: false,
        public_message: `ARI reviewer corrected ship details${update.applied ? "" : " (recorded only)"}`,
      });
    } catch (error) {
      console.error("[ari-inbound] audit write failed for ship_updated", error);
    }

    return {
      ok: true,
      result: update.applied ? `applied:${update.note}` : `recorded:${update.note}`,
      shipId: ship.id,
      applied: update.applied,
    };
  }

  // Consecutive identical (id, event, decision) triples can only be redeliveries.
  const last = ship.ari_last_event;
  if (
    ship.ari_synced_at &&
    last &&
    last.id === payload.id &&
    last.event === payload.event &&
    (last.decision ?? null) === (payload.decision ?? null)
  ) {
    // ARI's resend re-derives the payload, so it can carry newer fields; refresh the advisory copy.
    await db
      .update(shipTable)
      .set({ ari_last_event: payload })
      .where(eq(shipTable.id, ship.id));
    return { ok: true, result: "dedup", shipId: ship.id, dedup: true };
  }

  const authoritative = await isAriAuthoritative();
  const reviewerUserId = await resolveAriReviewerUserId(payload.review?.reviewer);
  // audit_logs.actor_id is NOT NULL, so unmapped reviewers fall back to the ship owner.
  const auditActorId = reviewerUserId ?? ship.user_id;

  let applied = false;
  let note = "shadow";
  let surface = false;

  if (authoritative) {
    if (payload.event === "review.approved") {
      const approval = await applyAriApproval(
        ship,
        payload,
        reviewerUserId,
        auditActorId,
      );
      applied = approval.applied;
      note = approval.note;
      surface = approval.surface ?? false;
    } else if (payload.event === "review.changes" || payload.event === "review.rejected") {
      // Projects can't be resubmitted anymore, so ARI's "changes" (and its retryable system
      // rejects) are terminal rejections too.
      const [project] = await db
        .select({ id: projectTable.id, name: projectTable.name })
        .from(projectTable)
        .where(eq(projectTable.id, ship.project_id))
        .limit(1);
      const result = await markShipRejected({
        shipId: ship.id,
        shipBefore: ship,
        projectId: ship.project_id,
        projectName: project?.name ?? "your project",
        notifyUserId: ship.user_id,
        actorId: auditActorId,
        auditNotes: buildAriAuditNotes(payload),
        userMessage: payload.review?.note_to_maker?.trim() || null,
        decisionAttachments: null,
        slackAttribution: "",
        source: "ari",
      });
      applied = result.ok;
      note = result.ok ? "rejected" : result.reason;
    } else if (payload.event === "review.reverted") {
      ({ applied, note } = await applyAriUndo(ship, payload, auditActorId, "reverted"));
    } else if (payload.event === "review.requeued") {
      ({ applied, note } = await applyAriUndo(ship, payload, auditActorId, "requeued"));
    }
  }

  // Throw instead of writing the advisory: arming dedup on a non-applied decision would swallow
  // the corrected re-approval. No DB write keeps ARI's retries idempotent.
  if (surface) {
    console.warn(
      `[ari-inbound] ${payload.event} for ship ${ship.id} (ARI submission ${payload.id}) ` +
        `rejected back to ARI, not applied: ${note}`,
    );
    throw createError({
      statusCode: 422,
      statusMessage: `ARI ${payload.event} not applied: ${note}`,
    });
  }

  // Only applied decisions (never in shadow mode), so students aren't notified off recorded-only events.
  if (
    applied &&
    (payload.event === "review.approved" ||
      payload.event === "review.changes" ||
      payload.event === "review.rejected")
  ) {
    try {
      await deliverPersonalReviewerNotes(ship, payload);
    } catch (error) {
      console.error("[ari-inbound] personal reviewer note delivery failed", error);
    }
  }

  // After consequences, so a transient failure above leaves dedup unset and ARI's redelivery reprocesses.
  await db
    .update(shipTable)
    .set({
      ari_submission_id: payload.id,
      ari_status: payload.event.replace(/^review\./, ""),
      ari_synced_at: new Date(),
      ari_last_event: payload,
    })
    .where(eq(shipTable.id, ship.id));

  try {
    await writeAudit({
      actor_id: auditActorId,
      action: "ari_decision_received",
      entity_type: "ship",
      entity_id: String(ship.id),
      new_value: {
        event: payload.event,
        decision: payload.decision ?? null,
        ari_submission_id: payload.id,
        reviewer_email: payload.review?.reviewer?.email ?? null,
        approved_hours: approvedHoursFromPayload(payload),
        authoritative,
        applied,
        note,
      },
      sensitive: false,
      public_message: `ARI ${payload.event}${applied ? " applied" : " recorded"}`,
    });
  } catch (error) {
    console.error("[ari-inbound] audit write failed for decision_received", error);
  }

  return {
    ok: true,
    result: applied
      ? `applied:${note}`
      : authoritative
        ? `recorded:${note}`
        : "shadow_recorded",
    shipId: ship.id,
    applied,
  };
}
