// other users' rows that reference the nuked user are null'd, not deleted, so their data
// stays intact; the JSON backup lets restore undo the nuke

import { and, eq, inArray, sql as drSql } from "drizzle-orm";

import db from "../db";
import {
  auditLogTable,
  currencyTransactionTable,
  hackatimeSyncAuditTable,
  internalNotesTable,
  internalOAuthConnectionTable,
  journalsTable,
  loopsEventLogs,
  notificationDeliveryTable,
  notificationTable,
  notificationPreferencesTable,
  npsResponseTable,
  piiLockerTable,
  projectGrantTable,
  projectTable,
  referralRedemptionsTable,
  referralVisitsTable,
  sessions,
  shadowBanTable,
  shipTable,
  shopOrderTable,
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  userBackupTable,
  users,
} from "../db/schema";

type NukePayload = {
  users: unknown[];
  projects: unknown[];
  ships_as_owner: unknown[];
  ships_as_assignee: unknown[];
  journals_on_owned_projects: unknown[];
  journals_reviewed: unknown[];
  journals_archived: unknown[];
  shop_orders: unknown[];
  currency_transactions_as_user: unknown[];
  currency_transactions_as_creator: unknown[];
  project_grants_as_user: unknown[];
  project_grants_as_sender: unknown[];
  project_grants_as_canceller: unknown[];
  pii_locker: unknown[];
  shadow_bans_as_user: unknown[];
  shadow_bans_as_creator: unknown[];
  internal_notes_as_subject: unknown[];
  internal_notes_as_author: unknown[];
  support_tickets: unknown[];
  support_ticket_messages: unknown[];
  support_ticket_attachments: unknown[];
  support_tickets_claimed: unknown[];
  support_tickets_resolved: unknown[];
  hackatime_sync_audits: unknown[];
  referral_visits: unknown[];
  loops_event_logs: unknown[];
  audit_logs_as_actor: unknown[];
  sessions: unknown[];
  internal_oauth_connections: unknown[];
  notifications: unknown[];
  notification_deliveries: unknown[];
  notification_preferences: unknown[];
  nps_responses: unknown[];
  referral_redemptions: unknown[];
  users_referred_by: unknown[];
};

export async function nukeUser(
  targetUserId: string,
  actor: { id: string; name: string | null },
  reason: string | null,
): Promise<{ backupId: number; selfNuke: boolean }> {
  return await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) {
      throw new Error(`User ${targetUserId} not found`);
    }

    const ownedProjectRows = await tx.select().from(projectTable).where(eq(projectTable.user_id, targetUserId));
    const ownedProjectIds = ownedProjectRows.map(p => p.id);

    const ownedShipRows = await tx.select().from(shipTable).where(eq(shipTable.user_id, targetUserId));
    const ownedShipIds = ownedShipRows.map(s => s.id);

    const journalsOnOwnedProjects = ownedProjectIds.length
      ? await tx.select().from(journalsTable).where(inArray(journalsTable.project_id, ownedProjectIds))
      : [];

    const ownedTickets = await tx.select().from(supportTicketTable).where(eq(supportTicketTable.user_id, targetUserId));
    const ownedTicketIds = ownedTickets.map(t => t.id);

    const ownMessages = ownedTicketIds.length
      ? await tx.select().from(supportTicketMessageTable).where(inArray(supportTicketMessageTable.ticket_id, ownedTicketIds))
      : [];
    const allMessages = dedupeById([
      ...ownMessages,
      ...(await tx.select().from(supportTicketMessageTable).where(eq(supportTicketMessageTable.author_user_id, targetUserId))),
    ]);
    const allMessageIds = allMessages.map((m: any) => m.id);

    const messageAttachments = allMessageIds.length
      ? await tx.select().from(supportTicketAttachmentTable).where(inArray(supportTicketAttachmentTable.message_id, allMessageIds))
      : [];

    const ownedNotifications = await tx.select().from(notificationTable).where(eq(notificationTable.user_id, targetUserId));
    const ownedNotificationIds = ownedNotifications.map(n => n.id);
    const ownedNotificationDeliveries = ownedNotificationIds.length
      ? await tx.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notification_id, ownedNotificationIds))
      : [];

    const payload: NukePayload = {
      users: [target],
      projects: ownedProjectRows,
      ships_as_owner: ownedShipRows,
      ships_as_assignee: await tx.select().from(shipTable).where(eq(shipTable.assigned_user_id, targetUserId)),
      journals_on_owned_projects: journalsOnOwnedProjects,
      journals_reviewed: await tx.select().from(journalsTable).where(eq(journalsTable.reviewed_by, targetUserId)),
      journals_archived: await tx.select().from(journalsTable).where(eq(journalsTable.archived_by, targetUserId)),
      shop_orders: await tx.select().from(shopOrderTable).where(eq(shopOrderTable.user_id, targetUserId)),
      currency_transactions_as_user: await tx.select().from(currencyTransactionTable).where(eq(currencyTransactionTable.user_id, targetUserId)),
      currency_transactions_as_creator: await tx.select().from(currencyTransactionTable).where(eq(currencyTransactionTable.created_by_user_id, targetUserId)),
      project_grants_as_user: await tx.select().from(projectGrantTable).where(eq(projectGrantTable.user_id, targetUserId)),
      project_grants_as_sender: await tx.select().from(projectGrantTable).where(eq(projectGrantTable.sent_by_user_id, targetUserId)),
      project_grants_as_canceller: await tx.select().from(projectGrantTable).where(eq(projectGrantTable.cancelled_by_user_id, targetUserId)),
      pii_locker: await tx.select().from(piiLockerTable).where(eq(piiLockerTable.user_id, targetUserId)),
      shadow_bans_as_user: await tx.select().from(shadowBanTable).where(eq(shadowBanTable.user_id, targetUserId)),
      shadow_bans_as_creator: await tx.select().from(shadowBanTable).where(eq(shadowBanTable.created_by_user_id, targetUserId)),
      internal_notes_as_subject: await tx.select().from(internalNotesTable).where(eq(internalNotesTable.user_id, targetUserId)),
      internal_notes_as_author: await tx.select().from(internalNotesTable).where(eq(internalNotesTable.created_by, targetUserId)),
      support_tickets: ownedTickets,
      support_ticket_messages: allMessages,
      support_ticket_attachments: messageAttachments,
      support_tickets_claimed: await tx.select().from(supportTicketTable).where(eq(supportTicketTable.claimed_by_user_id, targetUserId)),
      support_tickets_resolved: await tx.select().from(supportTicketTable).where(eq(supportTicketTable.resolved_by_user_id, targetUserId)),
      hackatime_sync_audits: await tx.select().from(hackatimeSyncAuditTable).where(eq(hackatimeSyncAuditTable.user_id, targetUserId)),
      referral_visits: await tx.select().from(referralVisitsTable).where(eq(referralVisitsTable.user_id, targetUserId)),
      loops_event_logs: await tx.select().from(loopsEventLogs).where(eq(loopsEventLogs.user_id, targetUserId)),
      audit_logs_as_actor: await tx.select().from(auditLogTable).where(eq(auditLogTable.actor_id, targetUserId)),
      sessions: await tx.select().from(sessions).where(eq(sessions.userId, targetUserId)),
      internal_oauth_connections: await tx.select().from(internalOAuthConnectionTable).where(eq(internalOAuthConnectionTable.connected_by_user_id, targetUserId)),
      notifications: ownedNotifications,
      notification_deliveries: ownedNotificationDeliveries,
      notification_preferences: await tx.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.user_id, targetUserId)),
      nps_responses: await tx.select().from(npsResponseTable).where(eq(npsResponseTable.user_id, targetUserId)),
      referral_redemptions: await tx.select().from(referralRedemptionsTable).where(eq(referralRedemptionsTable.user_id, targetUserId)),
      // null'd below (not deleted) so the referred users keep their accounts
      users_referred_by: await tx.select().from(users).where(eq(users.referred_by_user_id, targetUserId)),
    };

    const [backup] = await tx
      .insert(userBackupTable)
      .values({
        original_user_id: target.id,
        original_email: target.email,
        original_name: target.name,
        nuked_by_user_id: actor.id,
        nuked_by_name: actor.name,
        reason,
        payload: payload as unknown as Record<string, unknown>,
      })
      .returning();

    await tx.update(shipTable).set({ assigned_user_id: null }).where(eq(shipTable.assigned_user_id, targetUserId));
    await tx.update(journalsTable).set({ reviewed_by: null }).where(eq(journalsTable.reviewed_by, targetUserId));
    await tx.update(journalsTable).set({ archived_by: null }).where(eq(journalsTable.archived_by, targetUserId));
    await tx.update(projectGrantTable).set({ sent_by_user_id: null }).where(eq(projectGrantTable.sent_by_user_id, targetUserId));
    await tx.update(projectGrantTable).set({ cancelled_by_user_id: null }).where(eq(projectGrantTable.cancelled_by_user_id, targetUserId));
    await tx.update(supportTicketTable).set({ claimed_by_user_id: null }).where(eq(supportTicketTable.claimed_by_user_id, targetUserId));
    await tx.update(supportTicketTable).set({ resolved_by_user_id: null }).where(eq(supportTicketTable.resolved_by_user_id, targetUserId));
    await tx.update(currencyTransactionTable).set({ created_by_user_id: null }).where(
      and(eq(currencyTransactionTable.created_by_user_id, targetUserId), drSql`${currencyTransactionTable.user_id} != ${targetUserId}`),
    );
    await tx.update(internalNotesTable).set({ created_by: null as unknown as string }).where(
      and(eq(internalNotesTable.created_by, targetUserId), drSql`${internalNotesTable.user_id} IS DISTINCT FROM ${targetUserId}`),
    );
    await tx.update(shadowBanTable).set({ created_by_user_id: null as unknown as string }).where(
      and(eq(shadowBanTable.created_by_user_id, targetUserId), drSql`${shadowBanTable.user_id} != ${targetUserId}`),
    );
    await tx.update(internalOAuthConnectionTable).set({ connected_by_user_id: null }).where(eq(internalOAuthConnectionTable.connected_by_user_id, targetUserId));
    await tx.update(users).set({ referred_by_user_id: null }).where(eq(users.referred_by_user_id, targetUserId));

    // FK-safe order
    if (allMessageIds.length) {
      await tx.delete(supportTicketAttachmentTable).where(inArray(supportTicketAttachmentTable.message_id, allMessageIds));
    }
    await tx.delete(supportTicketMessageTable).where(eq(supportTicketMessageTable.author_user_id, targetUserId));
    // messages on owned tickets must go before the tickets
    if (ownedTicketIds.length) {
      await tx.delete(supportTicketMessageTable).where(inArray(supportTicketMessageTable.ticket_id, ownedTicketIds));
      await tx.delete(supportTicketTable).where(inArray(supportTicketTable.id, ownedTicketIds));
    }

    if (ownedShipIds.length) {
      await tx.delete(journalsTable).where(inArray(journalsTable.linked_ship, ownedShipIds));
    }
    await tx.delete(projectGrantTable).where(eq(projectGrantTable.user_id, targetUserId));
    await tx.delete(currencyTransactionTable).where(eq(currencyTransactionTable.user_id, targetUserId));
    await tx.delete(shopOrderTable).where(eq(shopOrderTable.user_id, targetUserId));
    await tx.delete(shipTable).where(eq(shipTable.user_id, targetUserId));
    if (ownedProjectIds.length) {
      await tx.delete(journalsTable).where(inArray(journalsTable.project_id, ownedProjectIds));
      await tx.delete(projectTable).where(inArray(projectTable.id, ownedProjectIds));
    }
    await tx.delete(internalNotesTable).where(eq(internalNotesTable.user_id, targetUserId));
    await tx.delete(shadowBanTable).where(eq(shadowBanTable.user_id, targetUserId));
    await tx.delete(piiLockerTable).where(eq(piiLockerTable.user_id, targetUserId));
    await tx.delete(hackatimeSyncAuditTable).where(eq(hackatimeSyncAuditTable.user_id, targetUserId));
    await tx.delete(npsResponseTable).where(eq(npsResponseTable.user_id, targetUserId));
    await tx.delete(referralRedemptionsTable).where(eq(referralRedemptionsTable.user_id, targetUserId));
    await tx.delete(referralVisitsTable).where(eq(referralVisitsTable.user_id, targetUserId));
    await tx.delete(loopsEventLogs).where(eq(loopsEventLogs.user_id, targetUserId));
    await tx.delete(auditLogTable).where(eq(auditLogTable.actor_id, targetUserId));

    // dev has journals.user_id / ship_contributors.user_id FKs missing from the drizzle schema;
    // guarded by information_schema so this no-ops where they don't exist
    for (const { table, column } of [
      { table: "journals", column: "user_id" },
      { table: "ship_contributors", column: "user_id" },
    ]) {
      if (!/^[A-Za-z0-9_]+$/.test(table) || !/^[A-Za-z0-9_]+$/.test(column)) continue;
      const exists = await tx.execute<{ exists: boolean }>(drSql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
        ) AS exists
      `);
      const row: { exists: boolean } | undefined =
        (exists as unknown as { rows?: Array<{ exists: boolean }> }).rows?.[0]
        ?? (exists as unknown as Array<{ exists: boolean }>)[0];
      if (row?.exists) {
        await tx.execute(drSql.raw(`DELETE FROM "${table}" WHERE "${column}" = '${targetUserId.replace(/'/g, "''")}'`));
      }
    }

    // remaining dependents cascade-delete or null-out via FK
    await tx.delete(users).where(eq(users.id, targetUserId));

    return { backupId: backup.id, selfNuke: actor.id === target.id };
  });
}

export async function restoreUserFromBackup(
  backupId: number,
  actor: { id: string; name: string | null },
): Promise<{ restoredUserId: string }> {
  return await db.transaction(async (tx) => {
    const [backup] = await tx.select().from(userBackupTable).where(eq(userBackupTable.id, backupId)).limit(1);
    if (!backup) throw new Error(`Backup ${backupId} not found`);
    if (backup.restored_at) throw new Error(`Backup ${backupId} was already restored`);

    const payload = backup.payload as unknown as NukePayload;
    const targetUserId = backup.original_user_id;

    const [existing] = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (existing) {
      throw new Error(`User ${targetUserId} already exists; cannot restore`);
    }

    // the JSON backup turned Dates into ISO strings, which drizzle's timestamp writer rejects;
    // revive shallowly so nested ISO strings in JSON columns stay untouched
    const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
    const reviveTimestamps = <T extends Record<string, unknown>>(row: T): T => {
      const out: Record<string, unknown> = { ...row };
      for (const [key, value] of Object.entries(out)) {
        if (typeof value === "string" && ISO_DATETIME_RE.test(value)) {
          out[key] = new Date(value);
        }
      }
      return out as T;
    };

    const [userRow] = payload.users as Array<Record<string, unknown>>;
    await tx.insert(users).values(reviveTimestamps(userRow) as any);

    const safeInsert = async (table: any, rows: unknown[]) => {
      if (!rows.length) return;
      await tx.insert(table).values((rows as Array<Record<string, unknown>>).map(reviveTimestamps) as any);
    };

    await safeInsert(piiLockerTable, payload.pii_locker);
    await safeInsert(projectTable, payload.projects);
    await safeInsert(shipTable, payload.ships_as_owner);
    await safeInsert(journalsTable, payload.journals_on_owned_projects);
    await safeInsert(shopOrderTable, payload.shop_orders);
    await safeInsert(currencyTransactionTable, payload.currency_transactions_as_user);
    await safeInsert(projectGrantTable, payload.project_grants_as_user);
    await safeInsert(shadowBanTable, payload.shadow_bans_as_user);
    await safeInsert(internalNotesTable, payload.internal_notes_as_subject);
    await safeInsert(hackatimeSyncAuditTable, payload.hackatime_sync_audits);
    await safeInsert(referralVisitsTable, payload.referral_visits);
    await safeInsert(loopsEventLogs, payload.loops_event_logs);
    await safeInsert(auditLogTable, payload.audit_logs_as_actor);
    await safeInsert(sessions, payload.sessions);
    await safeInsert(notificationTable, payload.notifications);
    await safeInsert(notificationDeliveryTable, payload.notification_deliveries);
    await safeInsert(notificationPreferencesTable, payload.notification_preferences);
    await safeInsert(supportTicketTable, payload.support_tickets);
    await safeInsert(supportTicketMessageTable, payload.support_ticket_messages);
    await safeInsert(supportTicketAttachmentTable, payload.support_ticket_attachments);
    await safeInsert(npsResponseTable, payload.nps_responses ?? []);
    await safeInsert(referralRedemptionsTable, payload.referral_redemptions ?? []);

    for (const row of (payload.users_referred_by ?? []) as Array<{ id: string }>) {
      await tx.update(users).set({ referred_by_user_id: targetUserId }).where(eq(users.id, row.id));
    }

    for (const row of payload.ships_as_assignee as Array<{ id: number }>) {
      await tx.update(shipTable).set({ assigned_user_id: targetUserId }).where(eq(shipTable.id, row.id));
    }
    for (const row of payload.journals_reviewed as Array<{ id: number }>) {
      await tx.update(journalsTable).set({ reviewed_by: targetUserId }).where(eq(journalsTable.id, row.id));
    }
    for (const row of payload.journals_archived as Array<{ id: number }>) {
      await tx.update(journalsTable).set({ archived_by: targetUserId }).where(eq(journalsTable.id, row.id));
    }
    for (const row of payload.project_grants_as_sender as Array<{ id: number }>) {
      await tx.update(projectGrantTable).set({ sent_by_user_id: targetUserId }).where(eq(projectGrantTable.id, row.id));
    }
    for (const row of (payload.project_grants_as_canceller ?? []) as Array<{ id: number }>) {
      await tx.update(projectGrantTable).set({ cancelled_by_user_id: targetUserId }).where(eq(projectGrantTable.id, row.id));
    }
    for (const row of payload.support_tickets_claimed as Array<{ id: number }>) {
      await tx.update(supportTicketTable).set({ claimed_by_user_id: targetUserId }).where(eq(supportTicketTable.id, row.id));
    }
    for (const row of payload.support_tickets_resolved as Array<{ id: number }>) {
      await tx.update(supportTicketTable).set({ resolved_by_user_id: targetUserId }).where(eq(supportTicketTable.id, row.id));
    }
    for (const row of payload.currency_transactions_as_creator as Array<{ id: number }>) {
      await tx.update(currencyTransactionTable).set({ created_by_user_id: targetUserId }).where(eq(currencyTransactionTable.id, row.id));
    }
    for (const row of payload.internal_notes_as_author as Array<{ id: number }>) {
      await tx.update(internalNotesTable).set({ created_by: targetUserId }).where(eq(internalNotesTable.id, row.id));
    }
    for (const row of payload.shadow_bans_as_creator as Array<{ id: number }>) {
      await tx.update(shadowBanTable).set({ created_by_user_id: targetUserId }).where(eq(shadowBanTable.id, row.id));
    }
    for (const row of payload.internal_oauth_connections as Array<{ id: number }>) {
      await tx.update(internalOAuthConnectionTable).set({ connected_by_user_id: targetUserId }).where(eq(internalOAuthConnectionTable.id, row.id));
    }

    await tx.update(userBackupTable).set({ restored_at: new Date(), restored_by_user_id: actor.id }).where(eq(userBackupTable.id, backupId));

    return { restoredUserId: targetUserId };
  });
}

function dedupeById<T extends { id: number | string }>(rows: T[]): T[] {
  const seen = new Set<T["id"]>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
