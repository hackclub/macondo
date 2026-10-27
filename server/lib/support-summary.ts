// An external cron hits /api/internal/support/post-summary every 2 hours.

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import db from "../db";
import {
  auditLogTable,
  supportTicketTable,
  users,
} from "../db/schema";
import { postMessage } from "./slack-bot";

import { useRuntimeConfig } from "#imports";

const WINDOW_HOURS = 2;

function summaryChannel(): string | null {
  const config = useRuntimeConfig();
  const channel = config.slackSupportSummaryChannelId as string | undefined;
  return channel && channel.length > 0 ? channel : null;
}

export async function buildSupportSummary(): Promise<{
  openCount: number;
  claimedCount: number;
  handledInWindow: { actor: string; count: number }[];
  closedInWindow: { actor: string; count: number }[];
}> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const statusRows = await db
    .select({
      status: supportTicketTable.status,
      count: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(supportTicketTable)
    .where(inArray(supportTicketTable.status, ["open", "claimed"]))
    .groupBy(supportTicketTable.status);

  // Same credit rule as leaderboard.get.ts (claimer, else resolver, never the owner) so they can't drift.
  // username, not name: users.name holds the legal/PII name.
  async function handledInWindow(): Promise<{ actor: string; count: number }[]> {
    return ((await db.execute(sql`
      SELECT COALESCE(u.username, h.handler_id) AS actor, h.n AS count
      FROM (
        SELECT COALESCE(t.claimed_by_user_id, t.resolved_by_user_id) AS handler_id,
               COUNT(*)::int AS n
        FROM support_tickets t
        WHERE t.status = 'resolved'
          AND t.resolved_at IS NOT NULL
          AND t.resolved_at >= ${since.toISOString()}
          AND COALESCE(t.claimed_by_user_id, t.resolved_by_user_id) <> t.user_id
        GROUP BY 1
      ) h
      JOIN users u ON u.id = h.handler_id
      ORDER BY h.n DESC
    `)) as unknown as { actor: string; count: number }[]).map((r) => ({ actor: r.actor, count: Number(r.count) }));
  }

  // closing has no claim semantics, so it comes straight off the audit log
  async function countsByActor(
    action: "support_ticket.closed",
  ): Promise<{ actor: string; count: number }[]> {
    return (
      await db
        .select({
          actor_id: auditLogTable.actor_id,
          actor_name: users.name,
          count: sql<number>`COUNT(*)`.mapWith(Number),
        })
        .from(auditLogTable)
        .leftJoin(users, eq(users.id, auditLogTable.actor_id))
        .where(
          and(
            eq(auditLogTable.action, action),
            gte(auditLogTable.created_at, since),
          ),
        )
        .groupBy(auditLogTable.actor_id, users.name)
        .orderBy(sql`COUNT(*) DESC`)
    ).map((r) => ({ actor: r.actor_name ?? r.actor_id, count: r.count }));
  }

  return {
    openCount: statusRows.find((r) => r.status === "open")?.count ?? 0,
    claimedCount: statusRows.find((r) => r.status === "claimed")?.count ?? 0,
    handledInWindow: await handledInWindow(),
    closedInWindow: await countsByActor("support_ticket.closed"),
  };
}

function formatLeaderboard(entries: { actor: string; count: number }[]): string {
  if (entries.length === 0) return "_nobody_";
  return entries
    .map((e) => `• ${e.actor}: ${e.count}`)
    .join("\n");
}

export async function postSupportSummary(): Promise<
  | { ok: true; ts?: string }
  | { ok: false; error: string }
> {
  const channel = summaryChannel();
  if (!channel) return { ok: false, error: "no summary channel configured" };

  const s = await buildSupportSummary();
  const lines: string[] = [];
  lines.push(`*Support snapshot (last ${WINDOW_HOURS}h)*`);
  lines.push("");
  lines.push(
    `:large_yellow_circle: *${s.openCount}* open  ·  :large_blue_circle: *${s.claimedCount}* claimed`,
  );
  lines.push("");
  lines.push("*Handled in window*");
  lines.push(formatLeaderboard(s.handledInWindow));
  if (s.closedInWindow.length > 0) {
    lines.push("");
    lines.push("*Closed in window*");
    lines.push(formatLeaderboard(s.closedInWindow));
  }

  const res = await postMessage({ channel, text: lines.join("\n") });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, ts: res.ts };
}
