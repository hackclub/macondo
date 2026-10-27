import { and, desc, eq, inArray, sql } from "drizzle-orm";

import db from "../../../db";
import {
  currencyTransactionTable,
  projectGrantTable,
  projectTable,
  users,
} from "../../../db/schema";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

// Defaults to "queued" since the main admin view is grants waiting to be sent.
type GrantStatusFilter = "queued" | "sent" | "cancelled" | "all";

function parseStatus(raw: unknown): GrantStatusFilter {
  if (raw === "sent" || raw === "cancelled" || raw === "all") return raw;
  return "queued";
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const status = parseStatus(query.status);

  const whereConditions = [] as ReturnType<typeof eq>[];
  if (status !== "all") {
    whereConditions.push(eq(projectGrantTable.status, status));
  }

  // Search is filtered in JS after the join; grant queues stay small (a few hundred rows).
  let rows = await db
    .select({
      id: projectGrantTable.id,
      ship_id: projectGrantTable.ship_id,
      amount_cents: projectGrantTable.amount_cents,
      status: projectGrantTable.status,
      hcb_grant_id: projectGrantTable.hcb_grant_id,
      created_at: projectGrantTable.created_at,
      sent_at: projectGrantTable.sent_at,
      cancelled_at: projectGrantTable.cancelled_at,
      cancel_reason: projectGrantTable.cancel_reason,
      cancel_fruit_tx_id: projectGrantTable.cancel_fruit_tx_id,
      reissued_from_id: projectGrantTable.reissued_from_id,
      intended_send_action: projectGrantTable.intended_send_action,
      hcb_card_replaces_id: projectGrantTable.hcb_card_replaces_id,
      project: {
        id: projectTable.id,
        name: projectTable.name,
        fruit: projectTable.fruit,
        level: projectTable.level,
      },
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        slack_id: users.slack_id,
        hcb_email: users.hcb_email,
        username: users.username,
        hackatime_id: users.hackatime_id,
      },
    })
    .from(projectGrantTable)
    .innerJoin(projectTable, eq(projectGrantTable.project_id, projectTable.id))
    .innerJoin(users, eq(projectGrantTable.user_id, users.id))
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .orderBy(desc(projectGrantTable.created_at), desc(projectGrantTable.id))
    .limit(
      Math.min(
        Math.max(Number.parseInt(String(query.limit ?? "100"), 10) || 100, 1),
        500, // max page size
      ),
    );

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => {
      const hackatimeStr = r.user.hackatime_id != null
        ? String(r.user.hackatime_id)
        : "";
      return (
        r.project.name?.toLowerCase().includes(needle) ||
        r.user.name?.toLowerCase().includes(needle) ||
        r.user.email?.toLowerCase().includes(needle) ||
        r.user.hcb_email?.toLowerCase().includes(needle) ||
        r.user.slack_id?.toLowerCase().includes(needle) ||
        r.user.username?.toLowerCase().includes(needle) ||
        hackatimeStr.includes(needle)
      );
    });
  }

  // Cancel fruit counts as spent once the user's balance drops below it; the UI then disables Reverse.
  const cancelTxIds = rows
    .map((r) => r.cancel_fruit_tx_id)
    .filter((v): v is number => typeof v === "number");

  type UserIdTx = { amount: number; user_id: string };
  let cancelTxById = new Map<number, UserIdTx>();
  if (cancelTxIds.length > 0) {
    const txRows = await db
      .select({
        id: currencyTransactionTable.id,
        amount: currencyTransactionTable.amount,
        user_id: currencyTransactionTable.user_id,
      })
      .from(currencyTransactionTable)
      .where(inArray(currencyTransactionTable.id, cancelTxIds));
    cancelTxById = new Map(
      txRows.map((t) => [t.id, { amount: t.amount, user_id: t.user_id }]),
    );
  }

  const usersNeedingBalance = Array.from(
    new Set([...cancelTxById.values()].map((t) => t.user_id)),
  );
  const balances = new Map<string, number>();
  if (usersNeedingBalance.length > 0) {
    const balRows = await db
      .select({
        user_id: currencyTransactionTable.user_id,
        total: sql<number>`
          COALESCE(SUM(
            CASE
              WHEN ${currencyTransactionTable.counts} = true AND ${currencyTransactionTable.type} = 'increase'
                THEN ${currencyTransactionTable.amount}
              WHEN ${currencyTransactionTable.counts} = true AND ${currencyTransactionTable.type} = 'decrease'
                THEN -${currencyTransactionTable.amount}
              ELSE 0
            END
          ), 0)
        `.as("total"),
      })
      .from(currencyTransactionTable)
      .where(inArray(currencyTransactionTable.user_id, usersNeedingBalance))
      .groupBy(currencyTransactionTable.user_id);
    for (const row of balRows) {
      balances.set(row.user_id, Number(row.total) || 0);
    }
  }

  // Latest prior sent card per project, so top_up/reissue rows can name their target card before Send.
  const queuedReferencingPrior = rows.filter(
    (r) =>
      r.status === "queued" &&
      (r.intended_send_action === "top_up" ||
        r.intended_send_action === "reissue"),
  );
  const projectIdsNeedingPrior = Array.from(
    new Set(queuedReferencingPrior.map((r) => r.project.id)),
  );
  const priorCardByProject = new Map<number, string>();
  if (projectIdsNeedingPrior.length > 0) {
    const priorRows = await db
      .select({
        project_id: projectGrantTable.project_id,
        hcb_grant_id: projectGrantTable.hcb_grant_id,
        sent_at: projectGrantTable.sent_at,
        id: projectGrantTable.id,
      })
      .from(projectGrantTable)
      .where(
        and(
          inArray(projectGrantTable.project_id, projectIdsNeedingPrior),
          eq(projectGrantTable.status, "sent"),
        ),
      )
      .orderBy(
        sql`${projectGrantTable.sent_at} DESC NULLS LAST`,
        desc(projectGrantTable.id),
      );
    // First match per project wins (most recent sent grant).
    for (const row of priorRows) {
      if (
        row.hcb_grant_id &&
        !priorCardByProject.has(row.project_id)
      ) {
        priorCardByProject.set(row.project_id, row.hcb_grant_id);
      }
    }
  }

  return {
    grants: rows.map((r) => {
      let fruitSpent = false;
      if (r.cancel_fruit_tx_id != null) {
        const tx = cancelTxById.get(r.cancel_fruit_tx_id);
        if (tx) {
          fruitSpent = (balances.get(tx.user_id) ?? 0) < tx.amount;
        }
      }
      return {
        ...r,
        fruit_spent: fruitSpent,
        prior_hcb_card_id:
          r.status === "queued" &&
          (r.intended_send_action === "top_up" ||
            r.intended_send_action === "reissue")
            ? (priorCardByProject.get(r.project.id) ?? null)
            : null,
      };
    }),
  };
});
