import db from "~~/server/db";
import { certificatesTable, users } from "~~/server/db/schema";
import { canAccessInternalCertificates } from "~~/server/policies/internal";
import { desc, eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalCertificates(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return {
    certificates: await db
      .select({
        id: certificatesTable.id,
        code: certificatesTable.code,
        user_id: certificatesTable.user_id,
        username: users.username,
        recipient_name: certificatesTable.recipient_name,
        hours_at_issue: certificatesTable.hours_at_issue,
        issued_at: certificatesTable.issued_at,
        revoked_at: certificatesTable.revoked_at,
        revoked_reason: certificatesTable.revoked_reason,
        issuer_id: certificatesTable.issuer_id,
      })
      .from(certificatesTable)
      .leftJoin(users, eq(users.id, certificatesTable.user_id))
      .orderBy(desc(certificatesTable.issued_at))
      .limit(500),
  };
});
