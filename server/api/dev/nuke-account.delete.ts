import { isDevDebugAvailable } from "../../lib/dev-debug-flags";
import { getSession } from "~~/server/lib/session";
import db from "~~/server/db";
import { eq, inArray, or } from "drizzle-orm";
import {
  users,
  sessions,
  projectTable,
  journalsTable,
  piiLockerTable,
  internalNotesTable,
  shadowBanTable,
  shipTable,
  auditLogTable,
  shopOrderTable,
  currencyTransactionTable,
  projectGrantTable,
  hackatimeSyncAuditTable,
  loopsEventLogs,
  internalOAuthConnectionTable,
  referralVisitsTable,
  supportTicketTable,
  supportTicketMessageTable,
} from "~~/server/db/schema";

export default defineEventHandler(async (event) => {
  if (!isDevDebugAvailable()) {
    throw createError({ statusCode: 403, statusMessage: "Only available in development" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const userId = user.id;

  const projectIds = (
    await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId))
  ).map((p) => p.id);

  // These rows survive (other users' data or historical logs), so only drop the reference.
  await db.update(journalsTable).set({ archived_by: null }).where(eq(journalsTable.archived_by, userId));
  await db.update(journalsTable).set({ reviewed_by: null }).where(eq(journalsTable.reviewed_by, userId));
  await db.update(shipTable).set({ assigned_user_id: null }).where(eq(shipTable.assigned_user_id, userId));
  await db.update(currencyTransactionTable).set({ created_by_user_id: null }).where(eq(currencyTransactionTable.created_by_user_id, userId));
  await db.update(internalOAuthConnectionTable).set({ connected_by_user_id: null }).where(eq(internalOAuthConnectionTable.connected_by_user_id, userId));
  await db.update(projectGrantTable).set({ sent_by_user_id: null }).where(eq(projectGrantTable.sent_by_user_id, userId));
  await db.update(supportTicketTable).set({ claimed_by_user_id: null }).where(eq(supportTicketTable.claimed_by_user_id, userId));
  await db.update(supportTicketTable).set({ resolved_by_user_id: null }).where(eq(supportTicketTable.resolved_by_user_id, userId));
  await db.update(internalNotesTable).set({ user_id: null }).where(eq(internalNotesTable.user_id, userId));
  await db.update(referralVisitsTable).set({ user_id: null }).where(eq(referralVisitsTable.user_id, userId));

  // FK order: project_grants references ships and currency_transactions, so it goes first.
  await db.delete(auditLogTable).where(eq(auditLogTable.actor_id, userId));
  await db.delete(hackatimeSyncAuditTable).where(eq(hackatimeSyncAuditTable.user_id, userId));
  await db.delete(loopsEventLogs).where(eq(loopsEventLogs.user_id, userId));
  await db.delete(piiLockerTable).where(eq(piiLockerTable.user_id, userId));
  await db.delete(projectGrantTable).where(eq(projectGrantTable.user_id, userId));
  if (projectIds.length > 0) {
    await db.delete(journalsTable).where(inArray(journalsTable.project_id, projectIds));
  }
  await db.delete(currencyTransactionTable).where(eq(currencyTransactionTable.user_id, userId));
  await db.delete(shopOrderTable).where(eq(shopOrderTable.user_id, userId));
  await db.delete(shipTable).where(eq(shipTable.user_id, userId));

  // Owned tickets cascade, but messages on other users' tickets still FK to users.id.
  await db.delete(supportTicketMessageTable).where(eq(supportTicketMessageTable.author_user_id, userId));

  // These created_by columns are notNull, so rows this user created go too.
  await db.delete(internalNotesTable).where(or(eq(internalNotesTable.user_id, userId), eq(internalNotesTable.created_by, userId)));
  await db.delete(shadowBanTable).where(or(eq(shadowBanTable.user_id, userId), eq(shadowBanTable.created_by_user_id, userId)));
  await db.delete(projectTable).where(eq(projectTable.user_id, userId));

  // Defensive; sessions cascade with the user row anyway.
  await db.delete(sessions).where(eq(sessions.userId, userId));

  await db.delete(users).where(eq(users.id, userId));

  deleteCookie(event, "macondo_session");

  return { success: true };
});
