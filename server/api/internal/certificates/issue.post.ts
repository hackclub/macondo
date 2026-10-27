// staff issues bypass the event-invite gate so certificates can be seeded or comped

import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { canAccessInternalCertificates } from "~~/server/policies/internal";
import { writeAudit } from "~~/server/lib/audit";
import {
  getActiveCertificateForUser,
  getCertifiableHours,
  insertCertificate,
  resolveDefaultRecipientName,
  toPublicCertificate,
} from "~~/server/lib/certificates";
import { eq } from "drizzle-orm";

type IssueBody = { user_id?: string; recipient_name?: string };

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalCertificates(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<IssueBody>(event).catch(() => ({}) as IssueBody);
  const targetUserId = (body?.user_id ?? "").trim();
  if (!targetUserId) {
    throw createError({ statusCode: 400, statusMessage: "user_id is required" });
  }

  const [target] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const existing = await getActiveCertificateForUser(targetUserId);
  if (existing) {
    return {
      ok: true,
      already: true,
      certificate: toPublicCertificate(existing, target.username ?? null),
    };
  }

  let recipientName = (body?.recipient_name ?? "").trim();
  if (!recipientName) {
    recipientName = await resolveDefaultRecipientName(targetUserId);
  }
  if (recipientName.length > 120) { // max recipient name length
    recipientName = recipientName.slice(0, 120).trim();
  }

  const hours = await getCertifiableHours(targetUserId);

  let cert;
  try {
    cert = await insertCertificate({
      userId: targetUserId,
      recipientName,
      hoursAtIssue: hours,
      issuerId: actor.id,
    });
  } catch (e) {
    const winner = await getActiveCertificateForUser(targetUserId);
    if (winner) {
      return {
        ok: true,
        already: true,
        certificate: toPublicCertificate(winner, target.username ?? null),
      };
    }
    throw e;
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "staff_issue_certificate",
      entity_type: "certificate",
      entity_id: cert.id,
      new_value: {
        code: cert.code,
        user_id: targetUserId,
        recipient_name: cert.recipient_name,
        hours_at_issue: cert.hours_at_issue,
      },
      change_summary: `Manually issued certificate ${cert.code} to ${target.username ?? targetUserId}`,
    });
  } catch (err) {
    console.error("[internal/certificates/issue] writeAudit failed", err);
  }

  return {
    ok: true,
    already: false,
    certificate: toPublicCertificate(cert, target.username ?? null),
  };
});
