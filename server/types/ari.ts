// Must mirror ari/src/lib/server/outbound.ts by hand; the repos are separate.

export type AriDecision = "approved" | "changes" | "rejected";

export type AriEventName =
  | "ship.updated"
  | "review.approved"
  | "review.changes"
  | "review.rejected"
  | "review.reverted"
  | "review.requeued";

export interface AriShipSnapshot {
  title: string;
  description: string | null;
  track: "software" | "hardware" | (string & {});
  thumbnail_url: string | null;
  authors: Array<{ email: string; name: string | null }>;
  repo_url: string;
  demo_url: string | null;
  hackatime_projects: string[];
}

export interface AriShipEditChange {
  field: string;
  old_value: string | string[] | null;
  new_value: string | string[] | null;
}

export interface AriMinutesBreakdown {
  hackatime?: number;
  journals?: number;
  lapse?: number;
  program?: number;
}

// Internal only, pasted straight into the Unified DB, so the comma-separated shapes are contract.
// Every part is omitted when empty.
export interface AriJustification {
  // `<project> M/D/YYYY-M/D/YYYY`, or a bare name when ARI couldn't resolve the window.
  hackatime_projects?: string;
  hackatime_user_id?: string;
  // the ONLY timelapse source on the Unified row; Macondo stores none itself
  lapse_links?: string;
  technical_features?: string;
  deflation_reason?: string;
  time_evidence?: string;
  supporting_evidence?: string;
  hours_reasoning?: string;
  additional_justification?: string;
  // hardware decisions with settled hours only
  unified_db_record?: string;
}

export interface AriReviewField {
  key: string;
  label: string;
  type: string;
  value: unknown;
}

export interface AriInboundCollaborator {
  email: string;
  name?: string | null;
  slack_id?: string | null;
  hackatime_id?: string | null;
  // decisions only (all zero on an auto-reject)
  approved_minutes?: number;
  approved_hours?: number;
  minutes_breakdown?: AriMinutesBreakdown;
  // Absent on older payloads, where review.justification.lapse_links is the only source.
  lapse_links?: string;
  // overrides the shared review.note_to_maker for this person
  note_to_maker?: string;
}

export interface AriInboundReview {
  note_to_maker: string;
  reviewer: { email: string; slack_id: string | null } | null;
  audit_note?: string;
  // decisions only
  approved_minutes?: number;
  approved_hours?: number;
  minutes_breakdown?: AriMinutesBreakdown;
  fields?: AriReviewField[];
  justification?: AriJustification;
}

// Stored verbatim on ships.ari_last_event for the review surfaces and idempotency check.
export interface AriInboundEvent {
  event: AriEventName | (string & {});
  // stable across redeliveries of the same decision
  id: string;
  external_id: string;
  // Absent means false. Approvals with priority pay gold restricted to priority-eligible items.
  priority?: boolean;
  maker?: { email: string; slack_id: string | null };
  collaborators?: AriInboundCollaborator[];
  review?: AriInboundReview;
  decision?: AriDecision | null;
  ship?: AriShipSnapshot;
  // ship.updated only; null when ARI couldn't resolve the editor
  edited_by?: { email: string; slack_id: string | null } | null;
  // ship.updated only
  changes?: AriShipEditChange[];
}
