// Unlock gate: Event Invite purchase plus staff-confirmed attendance (see claimCertificateForUser).

import { getSession } from "~~/server/lib/session";
import { checkRateLimit } from "~~/server/lib/rate-limit";
import { writeAudit } from "~~/server/lib/audit";
import {
  claimCertificateForUser,
  getActiveCertificateForUser,
  getCertifiableHours,
  resolveDefaultRecipientName,
  toPublicCertificate,
} from "~~/server/lib/certificates";

type ClaimBody = { recipient_name?: string };

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rate = await checkRateLimit(user.id, "cert-claim:user", 5, 60); // 5 claims per minute
  if (!rate.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.`,
    });
  }

  // Fast path only; the authoritative checks run again under the lock.
  const existing = await getActiveCertificateForUser(user.id);
  if (existing) {
    return {
      ok: true,
      already: true,
      certificate: toPublicCertificate(existing, user.username ?? null),
    };
  }

  const body = await readBody<ClaimBody>(event).catch(() => ({}) as ClaimBody);
  let recipientName = (body?.recipient_name ?? "").trim();
  if (!recipientName) {
    recipientName = await resolveDefaultRecipientName(user.id);
  }
  if (recipientName.length > 120) { // max recipient name length
    recipientName = recipientName.slice(0, 120).trim();
  }
  if (!recipientName) {
    throw createError({
      statusCode: 400,
      statusMessage: "A name is required on the certificate.",
    });
  }

  // The advisory lock stops a concurrent Event Invite cancel from stranding a new certificate.
  const result = await claimCertificateForUser({
    userId: user.id,
    recipientName,
    hoursAtIssue: await getCertifiableHours(user.id),
  });

  if (result.status === "needs_invite") {
    throw createError({
      statusCode: 409,
      statusMessage:
        "You need an Event Invite before you can earn your certificate. Get one in the shop.",
      data: { reason: "needs_event_invite" },
    });
  }

  if (result.status === "needs_attendance") {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Certificates unlock after the event. Once our team confirms you attended, you can claim yours here.",
      data: { reason: "needs_attendance" },
    });
  }

  if (result.status === "already") {
    return {
      ok: true,
      already: true,
      certificate: toPublicCertificate(result.cert, user.username ?? null),
    };
  }

  const cert = result.cert;

  try {
    await writeAudit({
      actor_id: user.id,
      action: "issue_certificate",
      entity_type: "certificate",
      entity_id: cert.id,
      new_value: {
        code: cert.code,
        hours_at_issue: cert.hours_at_issue,
        recipient_name: cert.recipient_name,
      },
      public_message: "Earned a Macondo certificate",
    });
  } catch (err) {
    console.error("[certificates/claim] writeAudit failed", err);
  }

  return {
    ok: true,
    already: false,
    certificate: toPublicCertificate(cert, user.username ?? null),
  };
});
