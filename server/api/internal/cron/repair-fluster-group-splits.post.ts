// Repairs group ships whose Fluster wrap-up payout went entirely to one contributor: before
// apply-fluster-decisions passed per-member hours, the split used the submit-time snapshot, which only
// has the owner's Hackatime. Re-splits the ship's frozen gold by what each member claims. If the person
// who was overpaid already spent the extra, orders they placed since the approval are cancelled and
// refunded, newest first and only as many as it takes to bring their balance back to zero or above.
// Dry run unless the body says `dryRun: false`.

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import db from "../../../db";
import {
  currencyTransactionTable,
  projectTable,
  shipContributorsTable,
  shipTable,
  shopOrderTable,
  users,
} from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { invalidateProject } from "../../../lib/cache";
import { clawBackUntilNonNegative } from "../../../lib/clawback";
import { planClawBackOps, type ClawBackTx } from "../../../lib/clawback-helpers";
import { splitGoldByHours } from "../../../lib/contributor-hours-split";
import { isValidCronToken } from "../../../lib/cron-token";
import { alertHcbGrantNeedsManualReturn } from "../../../lib/hcb-grant-return-alert";
import { notify } from "../../../lib/notify";
import { getContributorClaimedHours } from "../../../lib/ship-hours";
import { returnHcbGrantAndRefund } from "../../../lib/shop";
import { hasRole } from "../../../policies/internal";

type Share = { user_id: string; amount: number };

type Repair = {
  shipId: number;
  projectId: number;
  ok: boolean;
  note: string;
  gold?: number;
  before?: Share[];
  after?: Share[];
  // What the split is weighted by, next to what the reviewer saw: the owner's Hackatime snapshot
  // (the ship never snapshots anyone else's) and the hours they approved.
  hours?: {
    approved: number | null;
    ownerHackatimeAtSubmit: number | null;
    members: Array<{ user_id: string; hackatime: number; journals: number }>;
  };
  // The overpaid contributor: their gold balance once the split is corrected, and what brings it back to >= 0.
  overpaid?: {
    user_id: string;
    balanceAfterSplit: number;
    balanceAfterCancels: number;
    cancelledOrders: Array<{ id: number; status: string; item: string | null; gold: number }>;
    // HCB grant orders, returned through HCB after the split is committed.
    hcbGrantOrderIds?: number[];
    hcbGrantReturnFailedOrderIds?: number[];
  };
};

const REPAIR_MEMO = " [group split repair]";
const REPLACED_MEMO = " [replaced by group split repair]";

const goldBalance = (rows: ClawBackTx[], disabled: Set<number> = new Set()) =>
  rows.reduce(
    (sum, r) =>
      r.fruit_type === null && r.counts && r.unlocked_at !== null && !disabled.has(r.id)
        ? sum + (r.type === "increase" ? 1 : -1) * r.amount
        : sum,
    0,
  );

export default defineEventHandler(async (event) => {
  const sessionUser = event.context.user as (typeof users.$inferSelect) | null | undefined;
  const cronAllowed = isValidCronToken(event);
  const userAllowed = sessionUser != null && hasRole(sessionUser, ["supaadmin", "admin"]);
  if (!cronAllowed && !userAllowed) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{
    dryRun?: boolean;
    actorId?: string;
    shipIds?: number[];
    limit?: number;
  } | null>(event).catch(() => null);
  const dryRun = body?.dryRun !== false;
  const shipIds = Array.isArray(body?.shipIds)
    ? body!.shipIds!.filter((n) => Number.isInteger(n) && n > 0)
    : null;
  if (shipIds && shipIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "shipIds is empty" });
  }
  const limit = Number.isInteger(body?.limit) && body!.limit! > 0 ? body!.limit! : null;

  // audit_logs.actor_id is NOT NULL: the admin behind the run, from the session or (cron) the body.
  const actorId = sessionUser?.id ?? body?.actorId;
  if (!actorId) throw createError({ statusCode: 400, statusMessage: "actorId is required" });
  const [actor] = await db.select({ id: users.id, roles: users.roles }).from(users).where(eq(users.id, actorId)).limit(1);
  if (!actor || !hasRole(actor as typeof users.$inferSelect, ["supaadmin", "admin"])) {
    throw createError({ statusCode: 400, statusMessage: "actorId must be an admin" });
  }

  // Approved group ships that came through apply-fluster-decisions (its audit notes start this way).
  const ships = await db
    .select()
    .from(shipTable)
    .where(
      and(
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        sql`${shipTable.decision_audit_notes} LIKE 'Fluster wrap-up review%'`,
        sql`(SELECT count(*) FROM ${shipContributorsTable} WHERE ${shipContributorsTable.ship_id} = ${shipTable.id}) > 1`,
        shipIds ? inArray(shipTable.id, shipIds) : undefined,
      ),
    )
    .orderBy(asc(shipTable.id));

  // Sequential on purpose: each repair reads Hackatime per member and may talk to HCB.
  const results: Repair[] = [];
  let repaired = 0;
  for (const ship of ships) {
    if (limit !== null && repaired >= limit) break;
    const done = (ok: boolean, note: string, extra: Partial<Repair> = {}) =>
      results.push({ shipId: ship.id, projectId: ship.project_id, ok, note, ...extra });

    const [project] = await db
      .select({ id: projectTable.id, name: projectTable.name })
      .from(projectTable)
      .where(eq(projectTable.id, ship.project_id))
      .limit(1);
    if (!project) { done(false, "project_missing"); continue; }
    if (!ship.reviewed_at) { done(false, "no_reviewed_at"); continue; }

    const gold = ship.second_pass_gold_reward ?? 0;
    const rewardRows = await db
      .select()
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.ship_id, ship.id),
          eq(currencyTransactionTable.source, "ship_reward"),
          eq(currencyTransactionTable.type, "increase"),
          eq(currencyTransactionTable.counts, true),
          sql`${currencyTransactionTable.fruit_type} IS NULL`,
        ),
      );
    const paid = new Map<string, number>();
    for (const row of rewardRows) paid.set(row.user_id, (paid.get(row.user_id) ?? 0) + row.amount);
    const before = [...paid].map(([user_id, amount]) => ({ user_id, amount }));
    const template = rewardRows[0];
    if (!template || gold <= 0) { done(false, "no_gold_paid", { gold }); continue; }
    // A ledger that doesn't add up to the frozen reward was already touched by hand: leave it to a human.
    if (rewardRows.reduce((sum, r) => sum + r.amount, 0) !== gold) {
      done(false, "ledger_does_not_match_reward", { gold, before });
      continue;
    }
    // Only the bug this repairs: one person holding the whole reward. Any other split is left alone.
    if (paid.size !== 1) { done(false, "already_split", { gold, before }); continue; }
    const overpaidId = template.user_id;

    const claimed = await getContributorClaimedHours(ship);
    if (!claimed.ok) { done(false, "collaborator_hours_unreadable", { gold, before }); continue; }
    if (!claimed.hours) { done(false, "not_a_group_ship", { gold, before }); continue; }
    const split = splitGoldByHours(
      claimed.hours.map((c) => ({ user_id: c.user_id, hours: c.approved_hours })),
      gold,
      ship.override_hours ?? 0,
      ship.user_id,
    );
    const after = split.map(({ user_id, amount }) => ({ user_id, amount }));
    const hours = {
      approved: ship.override_hours,
      ownerHackatimeAtSubmit: ship.hackatime_hours,
      members: claimed.hours.map(({ user_id, hackatime, journals }) => ({ user_id, hackatime, journals })),
    };
    const target = split.find((s) => s.user_id === overpaidId)?.amount ?? 0;
    // Everyone else has no hours on it, so one person holding everything is the right split.
    if (target === gold) { done(true, "already_correct", { gold, before, after, hours }); continue; }

    const orderDetails = async (ids: number[]) => {
      if (ids.length === 0) return [];
      const orders = await db
        .select({ id: shopOrderTable.id, status: shopOrderTable.status, item_snapshot: shopOrderTable.item_snapshot })
        .from(shopOrderTable)
        .where(inArray(shopOrderTable.id, ids));
      return orders;
    };
    const ledgerOf = async (userId: string) =>
      (await db
        .select({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          type: currencyTransactionTable.type,
          source: currencyTransactionTable.source,
          fruit_type: currencyTransactionTable.fruit_type,
          memo: currencyTransactionTable.memo,
          shop_order_id: currencyTransactionTable.shop_order_id,
          unlocked_at: currencyTransactionTable.unlocked_at,
          counts: currencyTransactionTable.counts,
          created_at: currencyTransactionTable.created_at,
        })
        .from(currencyTransactionTable)
        .where(eq(currencyTransactionTable.user_id, userId))) as ClawBackTx[];
    /** What the overpaid person's orders and balance look like, given the debits that were (or would be) voided. */
    const overpaidReport = async (
      ledger: ClawBackTx[],
      voidedTxIds: number[],
      cancelledOrderIds: number[],
    ): Promise<NonNullable<Repair["overpaid"]>> => {
      const orders = await orderDetails(cancelledOrderIds);
      return {
        user_id: overpaidId,
        balanceAfterSplit: goldBalance(ledger),
        balanceAfterCancels: goldBalance(ledger, new Set(voidedTxIds)),
        cancelledOrders: orders.map((o) => ({
          id: o.id,
          status: o.status,
          item: (o.item_snapshot as { name?: string } | null)?.name ?? null,
          gold: ledger
            .filter((r) => r.shop_order_id === o.id && r.source === "shop_purchase" && r.type === "decrease" && r.fruit_type === null)
            .reduce((sum, r) => sum + r.amount, 0),
        })),
      };
    };

    if (dryRun) {
      // The ledger as the repair would leave it: the old reward gone, the corrected share in its place.
      const rewardIds = new Set(rewardRows.map((r) => r.id));
      const ledger = (await ledgerOf(overpaidId)).filter((r) => !rewardIds.has(r.id));
      if (target > 0) {
        ledger.push({
          id: -1, amount: target, type: "increase", source: "ship_reward", fruit_type: null, memo: null,
          shop_order_id: null, unlocked_at: template.unlocked_at, counts: true, created_at: new Date(),
        });
      }
      const plan = planClawBackOps(ledger, ship.reviewed_at, { minimal: true });
      repaired += 1;
      done(true, "would_repair", {
        gold,
        before,
        after,
        hours,
        overpaid: await overpaidReport(ledger, plan.disabledIds, plan.cancelledShopOrderIds),
      });
      continue;
    }

    const baseMemo = (template.memo ?? `Ship #${ship.id} approved`).replace(" (group share by hours)", "");
    let clawback: Awaited<ReturnType<typeof clawBackUntilNonNegative>>;
    try {
      clawback = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${ship.project_id}::bigint)`);
        // The purchase path's lock, so the balance can't be spent while it's being corrected.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${overpaidId})::bigint)`);

        const replaced = await tx
          .update(currencyTransactionTable)
          .set({
            counts: false,
            memo: sql`COALESCE(${currencyTransactionTable.memo}, '') || ${REPLACED_MEMO}`,
          })
          .where(
            and(
              inArray(currencyTransactionTable.id, rewardRows.map((r) => r.id)),
              eq(currencyTransactionTable.counts, true),
            ),
          )
          .returning({ id: currencyTransactionTable.id });
        // Reverted or repaired by someone else since it was read: roll back.
        if (replaced.length !== rewardRows.length) throw new Error("reward_rows_changed");

        for (const share of split) {
          await tx
            .update(shipContributorsTable)
            .set({ approved_hours: share.hours, fruit_awarded: Math.max(share.amount, 0) })
            .where(
              and(
                eq(shipContributorsTable.ship_id, ship.id),
                eq(shipContributorsTable.user_id, share.user_id),
              ),
            );
          if (share.amount <= 0) continue;
          // Same lock state as the reward it replaces (funded hardware gold waits on build proof).
          await tx.insert(currencyTransactionTable).values({
            user_id: share.user_id,
            amount: share.amount,
            type: "increase",
            source: "ship_reward",
            ship_id: ship.id,
            fruit_type: null,
            memo: `${baseMemo}${share.user_id === ship.user_id ? "" : " (group share by hours)"}${REPAIR_MEMO}`,
            counts: true,
            priority: template.priority,
            unlocked_at: template.unlocked_at,
            pending_for_project_id: template.pending_for_project_id,
            pending_for_ship_id: template.pending_for_ship_id,
          });
        }
        await tx
          .update(shipTable)
          .set({ second_pass_contributor_split: split })
          .where(eq(shipTable.id, ship.id));

        return await clawBackUntilNonNegative(tx, {
          userId: overpaidId,
          afterTimestamp: ship.reviewed_at!,
          reasonSuffix: `ship #${ship.id} group split corrected`,
          orderCancelLabel: "cancelled by group split repair",
          minimal: true,
        });
      });
    } catch (error) {
      done(false, `not_repaired: ${(error as Error)?.message ?? "transaction failed"}`, { gold, before, after });
      continue;
    }
    repaired += 1;
    await invalidateProject(project.id);

    // After the transaction so HCB calls are outside the locks. A failure leaves the order intact
    // and flags it for a manual return.
    const hcbFailed: number[] = [];
    for (const orderId of clawback.hcbGrantOrderIds) {
      try {
        const res = await returnHcbGrantAndRefund(orderId, actorId, {
          reasonLabel: `ship #${ship.id} group split corrected`,
        });
        if (!res.revoked) hcbFailed.push(orderId);
      } catch (error) {
        hcbFailed.push(orderId);
        const reason =
          (error as { statusMessage?: string; message?: string })?.statusMessage ??
          (error as Error)?.message ??
          "HCB grant return failed";
        console.error("[repair-fluster-group-splits] HCB grant return failed for order", orderId, reason);
        void alertHcbGrantNeedsManualReturn({ shipId: ship.id, orderIds: [orderId], reason });
      }
    }

    // Read back after the repair: the voided debits are already out of the balance.
    const ledger = await ledgerOf(overpaidId);
    const voided = new Set(clawback.disabledTxIds);
    const report = await overpaidReport(ledger, [], clawback.cancelledShopOrderIds);
    const overpaid = {
      ...report,
      balanceAfterSplit:
        report.balanceAfterCancels -
        ledger
          .filter((r) => voided.has(r.id) && r.fruit_type === null)
          .reduce((sum, r) => sum + (r.type === "decrease" ? 1 : -1) * r.amount, 0),
      hcbGrantOrderIds: clawback.hcbGrantOrderIds,
      hcbGrantReturnFailedOrderIds: hcbFailed,
    };

    try {
      await writeAudit({
        actor_id: actorId,
        action: "repair_fluster_group_split",
        entity_type: "ship",
        entity_id: String(ship.id),
        old_value: { split: ship.second_pass_contributor_split, reward_rows: rewardRows },
        new_value: {
          split,
          claimed_hours: claimed.hours,
          claw_back_disabled_currency_transaction_ids: clawback.disabledTxIds,
          claw_back_cancelled_shop_order_ids: clawback.cancelledShopOrderIds,
          hcb_grant_order_ids: clawback.hcbGrantOrderIds,
          hcb_grant_return_failed_order_ids: hcbFailed,
        },
        sensitive: true,
        public_message: "Group ship reward re-split between its contributors",
        change_summary: project.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for repair_fluster_group_split", ship.id, error);
    }

    for (const share of split) {
      if (share.user_id === overpaidId || share.amount <= 0) continue;
      void notify({
        user_id: share.user_id,
        type: "collab_ship_approved",
        title: "Your group project ship was approved",
        body: `You earned ${share.amount} gold from a ship on ${project.name}.`,
        action_url: `/projects/${project.id}`,
        entity_type: "ship",
        entity_id: String(ship.id),
      });
    }
    const cancelledIds = [...clawback.cancelledShopOrderIds, ...clawback.hcbGrantOrderIds.filter((id) => !hcbFailed.includes(id))];
    void notify({
      user_id: overpaidId,
      type: "gold_adjusted",
      title: `${project.name}: group reward corrected`,
      body:
        `This ship's ${gold} gold was paid to you alone by mistake. It's now shared with everyone on the project by hours, so your share is ${target} gold.` +
        (cancelledIds.length
          ? ` To keep your balance from going negative, these orders were cancelled and refunded: ${cancelledIds.map((id) => `#${id}`).join(", ")}.`
          : ""),
      action_url: `/projects/${project.id}`,
      entity_type: "ship",
      entity_id: String(ship.id),
    });

    done(hcbFailed.length === 0, hcbFailed.length === 0 ? "repaired" : "repaired_hcb_grant_return_failed", {
      gold,
      before,
      after,
      hours,
      overpaid,
    });
  }

  return { dryRun, count: results.length, results };
});
