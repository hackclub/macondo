// revoke rather than delete keeps history; the one-active partial index then allows a re-issue

import db from "~~/server/db";
import { certificatesTable } from "~~/server/db/schema";
import { canAccessInternalCertificates } from "~~/server/policies/internal";
import { writeAudit } from "~~/server/lib/audit";
import { eq } from "drizzle-orm";

type RevokeBody = { reason?: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalCertificates(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = getRouterParam(event, "id") ?? "";
  if (!UUID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid certificate id" });
  }

  const reason =
    ((await readBody<RevokeBody>(event).catch(() => ({}) as RevokeBody))?.reason ?? "").trim() || null;

  const [existing] = await db
    .select()
    .from(certificatesTable)
    .where(eq(certificatesTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Certificate not found" });
  }
  if (existing.revoked_at) {
    return { ok: true, already: true };
  }

  const revokedAt = new Date();
  await db
    .update(certificatesTable)
    .set({ revoked_at: revokedAt, revoked_reason: reason })
    .where(eq(certificatesTable.id, id));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "revoke_certificate",
      entity_type: "certificate",
      entity_id: id,
      old_value: { code: existing.code, revoked_at: null },
      new_value: { revoked_at: revokedAt.toISOString(), revoked_reason: reason },
      sensitive: true,
      change_summary: `Revoked certificate ${existing.code}`,
    });
  } catch (err) {
    console.error("[internal/certificates/revoke] writeAudit failed", err);
  }

  return { ok: true, already: false };
});
