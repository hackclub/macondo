// Read-only: the fines table lives in the Unified Airtable base and uses the unified token.

import { AIRTABLE_API_URL } from "./api-urls";

const FINES_BASE_ID = "app3A5kJwYqxMLOgh";
const FINES_TABLE_ID = "tblKzxJawDsetINVp";

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}
interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

// The MCP must not expose address/phone/birthday PII, so drop any field whose name looks like one.
const PII_FIELD_RE = /address|phone|\bdob\b|birth|postal|\bzip\b|street|city|state\b/i;
function scrubFineFields(rec: AirtableRecord): AirtableRecord {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec.fields)) {
    if (PII_FIELD_RE.test(k)) continue;
    fields[k] = v;
  }
  return { id: rec.id, fields, createdTime: rec.createdTime };
}

function unifiedToken(): string {
  const config = useRuntimeConfig();
  const token = (config as unknown as { airtableUnifiedToken?: string })
    .airtableUnifiedToken;
  if (!token) {
    throw new Error(
      "Unified Airtable token not configured (airtableUnifiedToken / NUXT_AIRTABLE_UNIFIED_TOKEN).",
    );
  }
  return token;
}

export async function fetchFines(opts?: {
  maxRecords?: number;
  filterByFormula?: string;
}): Promise<AirtableRecord[]> {
  const token = unifiedToken();
  const max = Math.min(Math.max(opts?.maxRecords ?? 25, 1), 100);
  const url = `${AIRTABLE_API_URL}/${FINES_BASE_ID}/${FINES_TABLE_ID}`;
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      pageSize: String(Math.min(max - out.length, 100)),
    });
    if (opts?.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    if (offset) params.set("offset", offset);

    const data = await $fetch<AirtableListResponse>(`${url}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    out.push(...data.records);
    offset = data.offset;
    pages += 1;
  } while (offset && out.length < max && pages < 5); // hard cap on pages fetched

  return out.slice(0, max).map(scrubFineFields);
}

export async function fetchFineById(recordId: string): Promise<AirtableRecord | null> {
  const token = unifiedToken();
  const url = `${AIRTABLE_API_URL}/${FINES_BASE_ID}/${FINES_TABLE_ID}/${recordId}`;
  try {
    const rec = await $fetch<AirtableRecord>(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return scrubFineFields(rec);
  } catch (e) {
    const status =
      (e as { response?: { status?: number } })?.response?.status ??
      (e as { statusCode?: number })?.statusCode;
    if (status === 404) return null;
    throw e;
  }
}

// Airtable linked records and lookups surface as arrays, so string-array fields are searched too.
export function extractMacondoRecordId(
  fields: Record<string, unknown>,
): string | null {
  const isRec = (s: string) => /^rec[A-Za-z0-9]{14,17}$/.test(s.trim());
  const fineId = fields["fine_id"];
  if (typeof fineId === "string") {
    const m = /^FINE-(rec[A-Za-z0-9]{14,17})-/.exec(fineId.trim());
    if (m) return m[1]!;
  }
  const proj = fields["project"];
  if (typeof proj === "string" && isRec(proj)) return proj.trim();
  if (Array.isArray(proj)) {
    for (const item of proj) {
      if (typeof item === "string" && isRec(item)) return item.trim();
    }
  }
  // Skip the Spotcheck linked field: it lists the spotcheck record, not the fined ship.
  for (const [key, v] of Object.entries(fields)) {
    if (key === "YSWS - Spotchecks") continue;
    if (typeof v === "string" && isRec(v)) return v.trim();
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && isRec(item)) return item.trim();
      }
    }
  }
  return null;
}

const REC_RE = /^rec[A-Za-z0-9]{14,17}$/;
function firstRec(v: unknown): string | null {
  if (typeof v === "string" && REC_RE.test(v.trim())) return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string" && REC_RE.test(item.trim())) return item.trim();
    }
  }
  return null;
}

// Returns null on any non-2xx (403 for a record in another table) so callers degrade gracefully.
async function fetchUnifiedRecord(
  tableIdOrName: string,
  recordId: string,
): Promise<AirtableRecord | null> {
  const token = unifiedToken();
  const url = `${AIRTABLE_API_URL}/${FINES_BASE_ID}/${encodeURIComponent(tableIdOrName)}/${recordId}`;
  try {
    return await $fetch<AirtableRecord>(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
}

// LeafdBot flags duplicate Code URLs; drydock sonar auto-creates a spotcheck for projects that never had one.
export type FineSource =
  | "leafdbot_duplicate_code_url"
  | "drydock_sonar_no_spotcheck"
  | "other";

function classifyFineSource(notes: string | null): FineSource {
  if (!notes) return "other";
  if (/duplicate code url/i.test(notes)) return "leafdbot_duplicate_code_url";
  if (/drydock sonar/i.test(notes)) return "drydock_sonar_no_spotcheck";
  return "other";
}

export interface FineResolution {
  spotcheckId: string | null;
  approvedProjectId: string | null;
  // `source` comes from the first-review note (a creation stub for automated rows);
  // `verdict`/`reason` prefer the third review, where the human decision lands.
  source: FineSource;
  sourceNote: string | null;
  reviewer: string | null;
  verdict: string | null;
  reason: string | null;
  firstReviewStatus: string | null;
  firstReviewNotes: string | null;
  thirdReviewStatus: string | null;
  thirdReviewNotes: string | null;
  // Maps to Macondo via repository_url / users.email. No address PII is read.
  codeUrl: string | null;
  playableUrl: string | null;
  email: string | null;
  makerName: string | null;
  overrideHours: number | null;
  approvedAt: string | null;
}

// A fine's record id is NOT ships.airtable_record_id (that lives in Macondo's own base); the real link
// is fine -> spotcheck -> approved_projects row. DB resolution happens in the MCP tool.
export async function resolveFineToUnifiedProject(
  fields: Record<string, unknown>,
): Promise<FineResolution | null> {
  const spotcheckId = firstRec(fields["YSWS - Spotchecks"]);
  if (!spotcheckId) return null;

  const spot = await fetchUnifiedRecord("YSWS - Spotchecks", spotcheckId);
  if (!spot) return null;
  const sf = spot.fields;

  const strf = (k: string) =>
    typeof sf[k] === "string" ? (sf[k] as string).trim() || null : null;
  const firstReviewStatus = strf("status_first_review");
  const firstReviewNotes = strf("first_review_notes");
  const firstReviewBy = strf("first_review_by");
  const thirdReviewStatus = strf("status_third_review");
  const thirdReviewNotes = strf("third_review_notes");
  const thirdReviewBy = strf("third_review_by");

  const approvedProjectId = firstRec(sf["project_eliminated"]);

  let codeUrl: string | null = null;
  let playableUrl: string | null = null;
  let email: string | null = null;
  let makerName: string | null = null;
  let overrideHours: number | null = null;
  let approvedAt: string | null = null;

  if (approvedProjectId) {
    const ap = await fetchUnifiedRecord(
      "tblzWWGUYHVH7Zyqf", // approved_projects table
      approvedProjectId,
    );
    if (ap) {
      const af = ap.fields;
      const strOf = (k: string) =>
        typeof af[k] === "string" ? (af[k] as string) : null;
      codeUrl = strOf("Code URL");
      playableUrl = strOf("Playable URL");
      email = strOf("Email");
      makerName = `${strOf("First Name") ?? ""} ${strOf("Last Name") ?? ""}`.trim() || null;
      const oh = af["Override Hours Spent"] ?? af["Hours Spent"];
      overrideHours = typeof oh === "number" ? oh : null;
      approvedAt = strOf("Approved At");
    }
  }

  return {
    spotcheckId,
    approvedProjectId,
    source: classifyFineSource(firstReviewNotes),
    sourceNote: firstReviewNotes,
    // An auto-created row's first-review note is a stub, so prefer the third review.
    reviewer: thirdReviewBy ?? firstReviewBy,
    verdict: thirdReviewStatus ?? firstReviewStatus,
    reason: thirdReviewNotes ?? firstReviewNotes,
    firstReviewStatus,
    firstReviewNotes,
    thirdReviewStatus,
    thirdReviewNotes,
    codeUrl,
    playableUrl,
    email,
    makerName,
    overrideHours,
    approvedAt,
  };
}
