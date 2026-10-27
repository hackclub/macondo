// A certificate unlocks only with BOTH a valid Event Invite order and staff-confirmed attendance.
// Hours are shown and snapshotted but are NOT the claim gate.

import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";

import db from "../db";
import {
  certificatesTable,
  eventAttendeeTable,
  piiLockerTable,
  shipContributorsTable,
  shipTable,
  shopItemTable,
  shopOrderTable,
  users,
} from "../db/schema";
import { generateCrockfordChars, normalizeCrockfordChars } from "./invite-code";
import { EVENT_INVITE_SLUG } from "./shop";

export const CERTIFICATE_THRESHOLD_HOURS = 20;
export const CERTIFICATE_PROGRAM_NAME = "Macondo 20-Hour Certificate";

// Keys map to logo files in public/images/certificate/sponsors/{key}.webp and {key}-cream.webp.
export const SPONSORS = [
  { key: "mit", name: "MIT School of Engineering" },
  { key: "github", name: "GitHub" },
  { key: "amd", name: "AMD" },
  { key: "cac", name: "Congressional App Challenge" },
  { key: "gwc", name: "Girls Who Code" },
] as const;

// 60 bits (vs the invite code's 40) since certificates are permanent and public.
const CERT_CODE_CHARS = 12;

const ORDER_STATUSES_NOT_PURCHASED: ("cancelled" | "external_failure")[] = [
  "cancelled",
  "external_failure",
];

export type CertificateRow = typeof certificatesTable.$inferSelect;

// Lets cancel endpoints run the stranded check / revoke inside their refund transaction.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const CERT_REVOKE_REASON_ORDER_CANCELLED =
  "Event Invite purchase was cancelled and refunded, so the certificate is no longer backed by a valid purchase.";

export function formatCertificateCode(rawChars: string): string {
  return `${rawChars.slice(0, 4)}-${rawChars.slice(4, 8)}-${rawChars.slice(8, 12)}`;
}

export function generateCertificateCode(): string {
  return formatCertificateCode(generateCrockfordChars(CERT_CODE_CHARS));
}

export function tryNormalizeCertificateCode(
  input: string,
): { ok: true; code: string } | { ok: false; reason: string } {
  const chars = normalizeCrockfordChars(input ?? "", CERT_CODE_CHARS);
  if (!chars) {
    return { ok: false, reason: "Invalid certificate code format." };
  }
  return { ok: true, code: formatCertificateCode(chars) };
}

// Sums ship_contributors slices, not ship.override_hours: group ship rows carry the whole team's total under the owner.
export async function getCertifiableHours(userId: string): Promise<number> {
  const [row] = await db
    .select({
      hours: sql<number>`COALESCE(SUM(COALESCE(${shipContributorsTable.approved_hours}, 0)), 0)`,
    })
    .from(shipContributorsTable)
    .innerJoin(shipTable, eq(shipTable.id, shipContributorsTable.ship_id))
    .where(
      and(
        eq(shipContributorsTable.user_id, userId),
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
      ),
    );
  return Math.round(Number(row?.hours ?? 0) * 10) / 10;
}

// attended_at is only ever set by hand from the internal event editor, so this is the manual-approval gate.
export async function userHasApprovedAttendance(
  userId: string,
  executor: DbOrTx = db,
): Promise<boolean> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(eventAttendeeTable)
    .where(
      and(
        eq(eventAttendeeTable.user_id, userId),
        sql`${eventAttendeeTable.attended_at} IS NOT NULL`,
      ),
    );
  return Number(row?.count ?? 0) > 0;
}

// The event_invite item already requires a shipped project, so holding it implies the maker shipped.
export async function userHasBoughtEventInvite(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shopOrderTable)
    .innerJoin(shopItemTable, eq(shopItemTable.id, shopOrderTable.item_id))
    .where(
      and(
        eq(shopOrderTable.user_id, userId),
        eq(shopItemTable.slug, EVENT_INVITE_SLUG),
        notInArray(shopOrderTable.status, ORDER_STATUSES_NOT_PURCHASED),
      ),
    );
  return Number(row?.count ?? 0) > 0;
}

export async function getActiveCertificateForUser(
  userId: string,
  executor: DbOrTx = db,
): Promise<CertificateRow | null> {
  const [row] = await executor
    .select()
    .from(certificatesTable)
    .where(
      and(
        eq(certificatesTable.user_id, userId),
        sql`${certificatesTable.revoked_at} IS NULL`,
      ),
    )
    .limit(1);
  return row ?? null;
}

// A certificate is only legitimately held while this stays >= 1; excludeOrderId asks "what if THIS order were cancelled?".
export async function countValidEventInvitePurchases(
  userId: string,
  opts: { excludeOrderId?: number } = {},
  executor: DbOrTx = db,
): Promise<number> {
  const conditions = [
    eq(shopOrderTable.user_id, userId),
    eq(shopItemTable.slug, EVENT_INVITE_SLUG),
    notInArray(shopOrderTable.status, ORDER_STATUSES_NOT_PURCHASED),
  ];
  if (opts.excludeOrderId != null) {
    conditions.push(ne(shopOrderTable.id, opts.excludeOrderId));
  }
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(shopOrderTable)
    .innerJoin(shopItemTable, eq(shopItemTable.id, shopOrderTable.item_id))
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

// Returns the active certificate if cancelling this order would leave no backing Event Invite purchase.
export async function getCertificateStrandedByCancel(
  userId: string,
  orderId: number,
  executor: DbOrTx = db,
): Promise<CertificateRow | null> {
  const active = await getActiveCertificateForUser(userId, executor);
  if (!active) return null;
  return (await countValidEventInvitePurchases(userId, { excludeOrderId: orderId }, executor)) === 0
    ? active
    : null;
}

// Guarded on revoked_at IS NULL so a double-cancel can't overwrite an earlier reason.
export async function revokeCertificateInTx(
  certId: string,
  reason: string,
  revokedAt: Date,
  executor: DbOrTx = db,
): Promise<boolean> {
  return (
    await executor
      .update(certificatesTable)
      .set({ revoked_at: revokedAt, revoked_reason: reason })
      .where(
        and(
          eq(certificatesTable.id, certId),
          sql`${certificatesTable.revoked_at} IS NULL`,
        ),
      )
      .returning({ id: certificatesTable.id })
  ).length > 0;
}

export type CertificateEligibility = {
  eligible_hours: number;
  threshold: number;
  remaining: number;
  event_invite_purchased: boolean;
  attended: boolean;
  has_certificate: boolean;
  eligible: boolean;
  code: string | null;
};

export async function getCertificateEligibility(
  userId: string,
): Promise<CertificateEligibility> {
  const [eligibleHours, eventInvitePurchased, attended, active] =
    await Promise.all([
      getCertifiableHours(userId),
      userHasBoughtEventInvite(userId),
      userHasApprovedAttendance(userId),
      getActiveCertificateForUser(userId),
    ]);
  const hasCertificate = !!active;
  return {
    eligible_hours: eligibleHours,
    threshold: CERTIFICATE_THRESHOLD_HOURS,
    remaining:
      Math.round(Math.max(0, CERTIFICATE_THRESHOLD_HOURS - eligibleHours) * 10) /
      10,
    event_invite_purchased: eventInvitePurchased,
    attended,
    has_certificate: hasCertificate,
    eligible: eventInvitePurchased && attended && !hasCertificate,
    code: active?.code ?? null,
  };
}

export type PublicCertificate = {
  code: string;
  recipient_name: string;
  username: string | null;
  hours: number;
  issued_at: string;
  valid: boolean;
  program: string;
};

export async function getCertificateByCode(
  code: string,
): Promise<{ cert: CertificateRow; username: string | null } | null> {
  const [row] = await db
    .select({ cert: certificatesTable, username: users.username })
    .from(certificatesTable)
    .leftJoin(users, eq(users.id, certificatesTable.user_id))
    .where(eq(certificatesTable.code, code))
    .limit(1);
  return row ? { cert: row.cert, username: row.username } : null;
}

// Revoked returns valid:false (NOT a 404) so verifiers learn it was revoked.
export function toPublicCertificate(
  cert: CertificateRow,
  username: string | null,
): PublicCertificate {
  return {
    code: cert.code,
    recipient_name: cert.recipient_name,
    username: username ?? null,
    hours: Math.floor(Number(cert.hours_at_issue)),
    issued_at: cert.issued_at.toISOString(),
    valid: cert.revoked_at == null,
    program: CERTIFICATE_PROGRAM_NAME,
  };
}

export async function resolveDefaultRecipientName(
  userId: string,
): Promise<string> {
  const [pii] = await db
    .select({
      first: piiLockerTable.first_name,
      last: piiLockerTable.last_name,
    })
    .from(piiLockerTable)
    .where(eq(piiLockerTable.user_id, userId))
    .limit(1);
  const full = [pii?.first, pii?.last]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" ")
    .trim();
  if (full) return full;
  const [u] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.username?.trim() || "Macondo Maker";
}

export type ClaimCertificateResult =
  | { status: "issued"; cert: CertificateRow }
  | { status: "already"; cert: CertificateRow }
  | { status: "needs_invite" }
  | { status: "needs_attendance" };

// Uses the same per-user advisory lock as orders.post.ts so a claim can't race an Event Invite cancel;
// all gates are re-checked inside the lock right before insert.
export async function claimCertificateForUser(input: {
  userId: string;
  recipientName: string;
  hoursAtIssue: number;
}): Promise<ClaimCertificateResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId})::bigint)`,
        );
        const active = await getActiveCertificateForUser(input.userId, tx);
        if (active) return { status: "already" as const, cert: active };

        if ((await countValidEventInvitePurchases(input.userId, {}, tx)) === 0) {
          return { status: "needs_invite" as const };
        }

        if (!(await userHasApprovedAttendance(input.userId, tx))) {
          return { status: "needs_attendance" as const };
        }

        const [row] = await tx
          .insert(certificatesTable)
          .values({
            user_id: input.userId,
            code: generateCertificateCode(),
            hours_at_issue: input.hoursAtIssue,
            recipient_name: input.recipientName,
            issuer_id: null,
          })
          .returning();
        return { status: "issued" as const, cert: row! };
      });
    } catch (e) {
      lastErr = e;
      // The lock serializes claims, so only a code collision is retryable.
      if (((e as { message?: string })?.message ?? "").includes("certificates_code_unique")) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error("Failed to generate a unique certificate code");
}

export type IssueCertificateInput = {
  userId: string;
  recipientName: string;
  hoursAtIssue: number;
  // null = self-claimed; the staff actor id for a manual issue
  issuerId?: string | null;
};

// Does NOT check eligibility or one-active-per-user; that unique violation is rethrown for the caller.
export async function insertCertificate(
  input: IssueCertificateInput,
): Promise<CertificateRow> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCertificateCode();
    try {
      const [row] = await db
        .insert(certificatesTable)
        .values({
          user_id: input.userId,
          code,
          hours_at_issue: input.hoursAtIssue,
          recipient_name: input.recipientName,
          issuer_id: input.issuerId ?? null,
        })
        .returning();
      return row!;
    } catch (e) {
      lastErr = e;
      if (((e as { message?: string })?.message ?? "").includes("certificates_code_unique")) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error("Failed to generate a unique certificate code");
}
