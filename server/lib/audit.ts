import db from "../db";
import { auditLogTable } from "../db/schema";
import type { InferInsertModel } from "drizzle-orm";

export type AuditInsert = InferInsertModel<typeof auditLogTable> & {
  actor_id?: string;
};

export async function writeAudit(entry: AuditInsert) {
  const toInsert: AuditInsert = {
    actor_id: entry.actor_id ?? undefined,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    old_value: entry.old_value ?? undefined,
    new_value: entry.new_value ?? undefined,
    sensitive: !!entry.sensitive,
    public_message: entry.public_message ?? undefined,
    change_summary: entry.change_summary ?? undefined,
    created_at: new Date(),
  };

  await db.insert(auditLogTable).values(toInsert as typeof auditLogTable.$inferInsert);
}

export default { writeAudit };