// Free of Nuxt/Nitro deps so standalone bun scripts reuse the exact payload mapping and wire format.
// The body MUST be the exact string that was signed, so it's serialized once.

import { createHmac } from "node:crypto";
import { $fetch, FetchError } from "ofetch";

// ARI itself is unreachable or misconfigured, unlike the expected per-ship outcomes.
// The message only carries URLs and HTTP statuses, so it's safe to log.
export class AriUnreachableError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AriUnreachableError";
  }
}

export interface AriIngestConfig {
  baseUrl: string;
  programId: string;
  ingestSecret: string;
}

export interface AriPersonInput {
  email: string;
  name: string | null;
  slackId: string | null;
  hackatimeId: number | string | null;
}

export interface AriJournalInput {
  at: Date | null;
  hours: number | null;
  title: string;
  body: string;
  // Only used on collaborative ships, where ARI requires every journal to attribute to a collaborator.
  authorEmail: string | null;
}

export interface AriShipPayloadInput {
  // ARI's external_id identifies the PROJECT (one open ship per project); the ship id goes in meta.
  projectId: number;
  maker: AriPersonInput;
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  thumbnailUrl: string | null;
  track: "software" | "hardware";
  hackatimeProjects: string[];
  journals: AriJournalInput[];
  // Null = solo payload. ARI treats these people as the makers, so the caller puts the owner first.
  collaborators: AriPersonInput[] | null;
  isUpdate: boolean;
  updateDescription: string | null;
  // Backfill backdate; null on live submissions (ARI stamps now()).
  shippedAt: Date | null;
  // Clamped to ARI's limits here; ARI renders array values (e.g. cart screenshots) inline.
  meta: Record<string, string | string[] | null | undefined>;
}

export type AriBuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string };

const isHttpUrl = (v: string | null | undefined): v is string =>
  typeof v === "string" && /^https?:\/\//i.test(v.trim());

// git resolves its transport helper case-sensitively, so "Https://" fails the clone.
const normalizeScheme = (v: string): string =>
  v.trim().replace(/^(https?)(:\/\/)/i, (_, s: string, rest: string) => s.toLowerCase() + rest);

const hackatimeIdString = (v: number | string | null): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

/** Returns a skip reason when the ship can't meet ARI's hard requirements (mirrors ARI's validate()). */
export function buildAriShipPayload(input: AriShipPayloadInput): AriBuildResult {
  const maker = input.maker;
  if (!maker.email?.trim()) return { ok: false, reason: "no_maker_email" };
  if (!maker.name?.trim()) return { ok: false, reason: "no_maker_name" };
  if (!maker.slackId?.trim()) return { ok: false, reason: "no_slack_id" };
  if (!input.title?.trim()) return { ok: false, reason: "no_title" };
  if (!input.description?.trim()) return { ok: false, reason: "no_description" };
  if (!input.repoUrl?.trim()) return { ok: false, reason: "no_repo_url" };
  if (!isHttpUrl(input.thumbnailUrl)) return { ok: false, reason: "no_thumbnail" };
  if (input.track === "software" && !isHttpUrl(input.demoUrl)) {
    return { ok: false, reason: "no_demo_url" };
  }

  const hackatimeProjects = (input.hackatimeProjects ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  // Every journal must attribute to a collaborator, so journals by anyone else are dropped.
  const collabEmails = input.collaborators
    ? new Set(input.collaborators.map((c) => c.email.trim().toLowerCase()))
    : null;
  let droppedJournals = 0;
  const journals = input.journals
    .filter((j) => {
      if (!collabEmails) return true;
      const email = j.authorEmail?.trim().toLowerCase();
      if (email && collabEmails.has(email)) return true;
      droppedJournals++;
      return false;
    })
    .slice(0, 200)
    .map((j) => {
      const text = [j.title?.trim(), j.body?.trim()]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 10_000); // cap journal text length
      return {
        at: (j.at ?? new Date()).toISOString(),
        // ARI caps minutes at 24h per entry; clamp instead of failing the ship.
        hours: Math.min(24, Math.max(0, j.hours ?? 0)),
        text,
        markdown: text.slice(0, 50_000), // cap journal markdown length
        ...(collabEmails && j.authorEmail
          ? { email: j.authorEmail.trim().toLowerCase() }
          : {}),
      };
    })
    .filter((j) => j.text.length > 0);

  if (hackatimeProjects.length === 0 && journals.length === 0) {
    return { ok: false, reason: "no_evidence" };
  }

  // Meta: flat string map, max 24 entries, key <= 80 chars, value <= 2000.
  const meta: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(input.meta)) {
    if (v === null || v === undefined) continue;
    const key = k.trim().slice(0, 80);
    if (!key) continue;
    if (Array.isArray(v)) {
      const list = v
        .map((x) => String(x).trim().slice(0, 2000))
        .filter(Boolean)
        .slice(0, 24);
      if (list.length) meta[key] = list;
    } else {
      const value = String(v).trim().slice(0, 2000);
      if (value) meta[key] = value;
    }
    if (Object.keys(meta).length >= 24) break;
  }
  if (droppedJournals > 0 && Object.keys(meta).length < 24) {
    meta.macondo_dropped_journals = String(droppedJournals);
  }

  const collaborators = input.collaborators
    ?.slice(0, 10)
    .map((c) => ({
      email: c.email.trim().toLowerCase(),
      ...(c.name?.trim() ? { name: c.name.trim() } : {}),
      ...(c.slackId?.trim() ? { slack_id: c.slackId.trim() } : {}),
      ...(hackatimeIdString(c.hackatimeId)
        ? { hackatime_id: hackatimeIdString(c.hackatimeId) }
        : {}),
    }));

  const updateMessage = input.isUpdate
    ? input.updateDescription?.trim().slice(0, 2000) || undefined // cap update message length
    : undefined;

  const payload: Record<string, unknown> = {
    external_id: String(input.projectId),
    maker: {
      email: maker.email.trim().toLowerCase(),
      name: maker.name!.trim(),
      slack_id: maker.slackId!.trim(),
      ...(hackatimeIdString(maker.hackatimeId)
        ? { hackatime_id: hackatimeIdString(maker.hackatimeId) }
        : {}),
    },
    title: input.title.trim(),
    description: input.description!.trim().slice(0, 10_000), // cap description length
    repo_url: normalizeScheme(input.repoUrl!),
    // ARI intersects this with the program's accepted evidence; omitting it records an empty set.
    evidence: ["commits", "elapsed", "devlog"],
    // Hardware ships carry a demo once the build is complete; ARI accepts it for hardware too.
    ...(isHttpUrl(input.demoUrl) ? { demo_url: input.demoUrl.trim() } : {}),
    thumbnail_url: input.thumbnailUrl!.trim(),
    track: input.track,
    hackatime_projects: hackatimeProjects,
    journals,
    ...(collaborators?.length ? { collaborators } : {}),
    ...(input.isUpdate ? { is_update: true } : {}),
    ...(updateMessage ? { update_message: updateMessage } : {}),
    ...(input.shippedAt ? { shipped_at: input.shippedAt.toISOString() } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
  };

  return { ok: true, payload };
}

/** HMAC-SHA256 hex over the exact raw body string, per ARI's wire contract. */
export function signAriBody(ingestSecret: string, rawBody: string): string {
  return createHmac("sha256", ingestSecret).update(rawBody, "utf8").digest("hex");
}

export type AriSubmitResult =
  // 200 duplicate is a byte-identical retry; both mean the ship is on ARI's queue.
  | { ok: true; status: "accepted" | "duplicate"; id: string }
  // The project already has an open ship; callers store its id and treat this as success.
  | { ok: false; status: "already_queued"; id: string | null }
  // A per-ship data problem, never retried verbatim.
  | { ok: false; status: "invalid_payload"; field: string | null };

/** Throws AriUnreachableError on network errors, 401 and 404 so config problems don't read as per-ship skips. */
export async function postAriIngest(
  cfg: AriIngestConfig,
  payload: Record<string, unknown>,
): Promise<AriSubmitResult> {
  const rawBody = JSON.stringify(payload);
  const signature = signAriBody(cfg.ingestSecret, rawBody);

  try {
    const data = await $fetch<{ status?: string; id?: string }>(
      `${cfg.baseUrl}/api/ingest/${cfg.programId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ari-signature": signature,
        },
        // Pass the signed string verbatim; re-serializing could break the signature.
        body: rawBody,
        timeout: 10_000,
      },
    );
    if ((data?.status === "accepted" || data?.status === "duplicate") && data.id) {
      return { ok: true, status: data.status, id: data.id };
    }
    throw new AriUnreachableError(
      `ari ingest returned unexpected body (status=${data?.status ?? "none"})`,
    );
  } catch (err) {
    if (err instanceof AriUnreachableError) throw err;
    if (err instanceof FetchError) {
      const body = (err.data ?? {}) as { error?: string; id?: string; field?: string };
      if (err.status === 409) {
        if (!body.id) {
          throw new AriUnreachableError(
            "ari ingest returned already_queued without a submission id",
            err,
          );
        }
        return { ok: false, status: "already_queued", id: body.id ?? null };
      }
      if (err.status === 422) {
        return { ok: false, status: "invalid_payload", field: body.field ?? null };
      }
      throw new AriUnreachableError(
        `ari POST /api/ingest failed: http ${err.status ?? "?"} ${body.error ?? err.message}`,
        err,
      );
    }
    throw new AriUnreachableError(
      `ari POST /api/ingest unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
