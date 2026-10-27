// Other resolve paths (student web, Slack ?resolve, reaction, button) still inline their own copies.

import { and, eq, sql, type SQL } from "drizzle-orm";

import db from "../db";
import { supportTicketTable, users } from "../db/schema";
import { notify } from "./notify";
import { draftKbSuggestionFromResolvedTicket } from "./support-kb-curation";
import { ensureTicketEmbedded } from "./support-ticket-embedding";
import { publishStatusChanged } from "./support-ticket-realtime";
import {
  postPublicThreadReply,
  reactResolvedOnOriginal,
  updateBtsMessage,
} from "./support-ticket-slack";

export type SupportTicketRow = typeof supportTicketTable.$inferSelect;

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// Clears the auto-resolve warning so no stale timer survives; null resolvedByUserId means automated.
// extraWhere lets the cron's freshness guard make a racing reply win.
export async function markTicketResolved(opts: {
  ticketId: number;
  resolvedByUserId: string | null;
  extraWhere?: SQL;
}): Promise<SupportTicketRow | null> {
  const conds: SQL[] = [
    eq(supportTicketTable.id, opts.ticketId),
    sql`${supportTicketTable.status} IN ('open', 'claimed')`,
  ];
  if (opts.extraWhere) conds.push(opts.extraWhere);

  const [updated] = await db
    .update(supportTicketTable)
    .set({
      status: "resolved",
      resolved_by_user_id: opts.resolvedByUserId,
      resolved_at: new Date(),
      auto_resolve_warned_at: null,
      updated_at: new Date(),
    })
    .where(and(...conds))
    .returning();
  return updated ?? null;
}

export async function fanOutResolveSideEffects(
  updated: SupportTicketRow,
  opts: {
    resolvedByName: string;
    resolvedByUserId: string | null;
    publicThreadText: string;
    notifyBody: string;
  },
): Promise<void> {
  const [authorRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, updated.user_id))
    .limit(1);

  void updateBtsMessage({
    id: updated.id,
    subject: updated.subject,
    body: updated.body,
    status: updated.status,
    priority: updated.priority,
    category: updated.category,
    claimed_by_name: null,
    resolved_by_name: opts.resolvedByName,
    author_display_name: authorRow?.name ?? null,
    author_avatar_url: null,
    slack_channel_id: updated.slack_channel_id,
    slack_thread_ts: updated.slack_thread_ts,
    bts_message_ts: updated.bts_message_ts,
  });

  const hasPublicThread =
    !!updated.slack_channel_id && !!updated.slack_thread_ts;
  if (hasPublicThread) {
    void postPublicThreadReply({
      channel: updated.slack_channel_id!,
      thread_ts: updated.slack_thread_ts!,
      text: opts.publicThreadText,
    });
    void reactResolvedOnOriginal({
      slack_channel_id: updated.slack_channel_id,
      slack_thread_ts: updated.slack_thread_ts,
    });
  }

  void publishStatusChanged(updated.id, updated.user_id, {
    status: "resolved",
    resolved_by_user_id: opts.resolvedByUserId,
    actorUserId: opts.resolvedByUserId,
  });

  // resolved tickets are the only ones surfaced as Capybara suggestions
  void ensureTicketEmbedded(updated.id);

  // self-no-ops and dedups, so firing from every resolve path is safe
  void draftKbSuggestionFromResolvedTicket(updated.id);

  const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${updated.id}`;
  void notify({
    user_id: updated.user_id,
    type: "ticket_resolved",
    title: `Ticket resolved: ${updated.subject}`,
    body: opts.notifyBody,
    action_url: ticketUrl,
    entity_type: "support_ticket",
    entity_id: String(updated.id),
    skip_channels: hasPublicThread ? ["slack"] : undefined,
    slack: hasPublicThread
      ? undefined
      : {
          text: `:white_check_mark: Ticket resolved: *${updated.subject}*\n<${ticketUrl}|Open ticket>`,
        },
    email: {
      template: "ticket_resolved",
      data: { ticket_subject: updated.subject, ticket_url: ticketUrl },
    },
  });
}
