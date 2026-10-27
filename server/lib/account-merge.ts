import { eq } from "drizzle-orm";
import db from "~~/server/db";
import {
	users,
	projectTable,
	shipTable,
	internalNotesTable,
	currencyTransactionTable,
	shopOrderTable,
	referralVisitsTable,
	loopsEventLogs,
	piiLockerTable,
	supportTicketTable,
	supportTicketMessageTable,
	notificationTable,
	hackatimeSyncAuditTable,
	projectGrantTable,
} from "~~/server/db/schema";

export interface MergeUserOptions {
	sourceId: string;
	targetId: string;
	// Applied after the source row is deleted so a shared unique value (email) can't collide.
	targetPatch?: Partial<typeof users.$inferInsert>;
}

// Journals have no user_id; they move with their projects.
// Only for draining a near-empty temp account: unlisted ON DELETE CASCADE tables
// would be wiped with the source, so audit the FK set before using it on a populated account.
export async function mergeUserInto({
	sourceId,
	targetId,
	targetPatch,
}: MergeUserOptions): Promise<void> {
	if (sourceId === targetId) {
		throw new Error("mergeUserInto: source and target are the same user");
	}

	await db.transaction(async (tx) => {
		// Cleared first so nothing re-resolves the source mid-merge or races a UNIQUE on hackatime_id.
		await tx
			.update(users)
			.set({ hackatime_id: null, hackatime_oauth_token: null })
			.where(eq(users.id, sourceId));

		await tx
			.update(projectTable)
			.set({ user_id: targetId })
			.where(eq(projectTable.user_id, sourceId));
		await tx
			.update(shipTable)
			.set({ user_id: targetId })
			.where(eq(shipTable.user_id, sourceId));
		await tx
			.update(internalNotesTable)
			.set({ user_id: targetId })
			.where(eq(internalNotesTable.user_id, sourceId));
		await tx
			.update(currencyTransactionTable)
			.set({ user_id: targetId })
			.where(eq(currencyTransactionTable.user_id, sourceId));
		await tx
			.update(shopOrderTable)
			.set({ user_id: targetId })
			.where(eq(shopOrderTable.user_id, sourceId));
		await tx
			.update(referralVisitsTable)
			.set({ user_id: targetId })
			.where(eq(referralVisitsTable.user_id, sourceId));
		await tx
			.update(loopsEventLogs)
			.set({ user_id: targetId })
			.where(eq(loopsEventLogs.user_id, sourceId));
		// These cascade on user delete, so they MUST be reparented before the source row is removed.
		await tx
			.update(supportTicketTable)
			.set({ user_id: targetId })
			.where(eq(supportTicketTable.user_id, sourceId));
		await tx
			.update(supportTicketMessageTable)
			.set({ author_user_id: targetId })
			.where(eq(supportTicketMessageTable.author_user_id, sourceId));
		await tx
			.update(notificationTable)
			.set({ user_id: targetId })
			.where(eq(notificationTable.user_id, sourceId));
		await tx
			.update(hackatimeSyncAuditTable)
			.set({ user_id: targetId })
			.where(eq(hackatimeSyncAuditTable.user_id, sourceId));
		await tx
			.update(projectGrantTable)
			.set({ user_id: targetId })
			.where(eq(projectGrantTable.user_id, sourceId));

		// pii_locker has UNIQUE(user_id): the target's existing row wins since it is the real identity.
		if (
			(
				await tx
					.select({ id: piiLockerTable.id })
					.from(piiLockerTable)
					.where(eq(piiLockerTable.user_id, targetId))
					.limit(1)
			).length > 0
		) {
			await tx
				.delete(piiLockerTable)
				.where(eq(piiLockerTable.user_id, sourceId));
		} else {
			await tx
				.update(piiLockerTable)
				.set({ user_id: targetId })
				.where(eq(piiLockerTable.user_id, sourceId));
		}

		await tx.delete(users).where(eq(users.id, sourceId));

		if (targetPatch && Object.keys(targetPatch).length > 0) {
			await tx.update(users).set(targetPatch).where(eq(users.id, targetId));
		}
	});
}
