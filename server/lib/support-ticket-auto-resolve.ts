// State is always recomputed from message rows, never trusted from a flag.
// No DB locks: warn and resolve are status-guarded atomic UPDATEs, so races just no-op.

import { and, eq, isNull, sql } from "drizzle-orm";

import db from "../db";
import { supportTicketMessageTable, supportTicketTable } from "../db/schema";
import { writeAudit } from "./audit";
import { notify } from "./notify";
import { CAPYBARA_USERNAME } from "./support-ticket-embedding";
import { publishMessageAdded } from "./support-ticket-realtime";
import {
  fanOutResolveSideEffects,
  markTicketResolved,
} from "./support-ticket-resolve";
import {
  postBtsThreadReply,
  postPublicThreadReply,
} from "./support-ticket-slack";

export const AUTO_RESOLVE_WARNING_AFTER_MS = 48 * 60 * 60 * 1000;
export const AUTO_RESOLVE_AFTER_WARNING_MS = 24 * 60 * 60 * 1000;
// cap per tick so a first-deploy backlog never floods the public channel
const BATCH_LIMIT = 25;

const WARNING_BODY =
  "Hi! Capybara here. It's been a couple of days since the last reply and " +
  "we haven't heard back from you. If everything's sorted, you don't need to " +
  "do anything, this ticket will be automatically marked resolved in 24 " +
  "hours. Still need help? Just reply here and we'll keep it open.";

const WARNING_SLACK =
  ":capybara: It's been a couple of days since the last reply and we " +
  "haven't heard back. If everything's sorted, no action needed, this ticket " +
  "will be automatically marked resolved in 24 hours. Still need help? Just " +
  "reply in this thread to keep it open.";

export interface AutoResolveSweepResult {
  cleared: number;
  warned: number;
  resolved: number;
  errors: number;
}

interface SweepTicket {
  id: number;
  user_id: string;
  subject: string;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  bts_message_ts: string | null;
}

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const maybe = (res as { rows?: unknown[] }).rows;
  return (Array.isArray(maybe) ? maybe : []) as Array<Record<string, unknown>>;
}

function toSweepTicket(r: Record<string, unknown>): SweepTicket {
  return {
    id: typeof r.id === "string" ? Number(r.id) : (r.id as number),
    user_id: String(r.user_id),
    subject: String(r.subject),
    slack_channel_id: (r.slack_channel_id as string | null) ?? null,
    slack_thread_ts: (r.slack_thread_ts as string | null) ?? null,
    bts_message_ts: (r.bts_message_ts as string | null) ?? null,
  };
}

// Cutoffs are ISO strings cast to `timestamp` (tz-naive UTC columns); binding a JS Date crashes postgres-js.
const LATERAL_LAST_MESSAGE = sql`
  JOIN LATERAL (
    SELECT m.author_user_id, m.created_at
    FROM support_ticket_messages m
    WHERE m.ticket_id = t.id
      AND m.author_kind = 'user' AND m.author_user_id IS NOT NULL
      AND m.is_internal_note = false AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lastmsg ON true
`;

// an owner reply cancels the warning; a staff follow-up re-arms a fresh 48h window
async function clearStaleWarnings(): Promise<number> {
  return rowsOf(await db.execute(sql`
    UPDATE support_tickets t
    SET auto_resolve_warned_at = NULL
    WHERE t.status IN ('open', 'claimed')
      AND t.auto_resolve_warned_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM support_ticket_messages m
        WHERE m.ticket_id = t.id
          AND m.author_kind = 'user' AND m.author_user_id IS NOT NULL
          AND m.is_internal_note = false AND m.deleted_at IS NULL
          AND m.created_at > t.auto_resolve_warned_at
      )
    RETURNING t.id
  `)).length;
}

async function findWarnCandidates(warnCutoffIso: string): Promise<SweepTicket[]> {
  return rowsOf(await db.execute(sql`
    SELECT t.id, t.user_id, t.subject,
           t.slack_channel_id, t.slack_thread_ts, t.bts_message_ts
    FROM support_tickets t
    ${LATERAL_LAST_MESSAGE}
    WHERE t.status IN ('open', 'claimed')
      AND t.auto_resolve_warned_at IS NULL
      AND lastmsg.author_user_id <> t.user_id
      AND lastmsg.created_at <= ${warnCutoffIso}::timestamp
    ORDER BY lastmsg.created_at ASC
    LIMIT ${BATCH_LIMIT}
  `)).map(toSweepTicket);
}

async function findResolveCandidates(
  resolveCutoffIso: string,
): Promise<SweepTicket[]> {
  return rowsOf(await db.execute(sql`
    SELECT t.id, t.user_id, t.subject,
           t.slack_channel_id, t.slack_thread_ts, t.bts_message_ts
    FROM support_tickets t
    ${LATERAL_LAST_MESSAGE}
    WHERE t.status IN ('open', 'claimed')
      AND t.auto_resolve_warned_at IS NOT NULL
      AND t.auto_resolve_warned_at <= ${resolveCutoffIso}::timestamp
      AND lastmsg.author_user_id <> t.user_id
      AND lastmsg.created_at <= t.auto_resolve_warned_at
    ORDER BY t.auto_resolve_warned_at ASC
    LIMIT ${BATCH_LIMIT}
  `)).map(toSweepTicket);
}

async function warnOne(ticket: SweepTicket): Promise<boolean> {
  // atomic claim: a losing racer gets no row and skips
  const [claimed] = await db
    .update(supportTicketTable)
    .set({ auto_resolve_warned_at: new Date() })
    .where(
      and(
        eq(supportTicketTable.id, ticket.id),
        sql`${supportTicketTable.status} IN ('open', 'claimed')`,
        isNull(supportTicketTable.auto_resolve_warned_at),
      ),
    )
    .returning({ id: supportTicketTable.id });
  if (!claimed) return false;

  // revert the claim on failure so no timer is armed without a visible warning
  let messageId: number | null = null;
  try {
    const [inserted] = await db
      .insert(supportTicketMessageTable)
      .values({
        ticket_id: ticket.id,
        author_user_id: null,
        author_kind: "capybara",
        body: WARNING_BODY,
        is_internal_note: false,
      })
      .returning({ id: supportTicketMessageTable.id });
    messageId = inserted?.id ?? null;
  } catch (err) {
    await db
      .update(supportTicketTable)
      .set({ auto_resolve_warned_at: null })
      .where(eq(supportTicketTable.id, ticket.id));
    throw err;
  }

  if (messageId != null) void publishMessageAdded(ticket.id, messageId);

  if (ticket.slack_channel_id && ticket.slack_thread_ts) {
    void postPublicThreadReply({
      channel: ticket.slack_channel_id,
      thread_ts: ticket.slack_thread_ts,
      text: WARNING_SLACK,
      username: CAPYBARA_USERNAME,
    });
  }
  if (ticket.bts_message_ts) {
    void postBtsThreadReply({
      bts_message_ts: ticket.bts_message_ts,
      text: WARNING_SLACK,
      username: CAPYBARA_USERNAME,
    });
  }

  try {
    await writeAudit({
      actor_id: ticket.user_id,
      action: "support_ticket.auto_resolve_warned",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: null,
      new_value: { via: "auto-resolve-cron" },
      sensitive: false,
      public_message: `Capybara inactivity warning posted on ticket #${ticket.id}`,
      change_summary: ticket.subject,
    });
  } catch (err) {
    console.error("[cron-auto-resolve] audit warn failed", ticket.id, err);
  }

  const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${ticket.id}`;
  void notify({
    user_id: ticket.user_id,
    type: "ticket_reply",
    title: `New reply on: ${ticket.subject}`,
    body:
      "We haven't heard back, so this ticket will auto-resolve in 24 hours " +
      "unless you reply.",
    action_url: ticketUrl,
    entity_type: "support_ticket",
    entity_id: String(ticket.id),
    // DM only when there's no public thread to read the warning in
    slack: !!ticket.slack_channel_id && !!ticket.slack_thread_ts ? undefined : { text: WARNING_SLACK },
    email: {
      template: "ticket_reply",
      data: {
        ticket_subject: ticket.subject,
        staff_name: "Capybara",
        reply_body: WARNING_BODY,
        ticket_url: ticketUrl,
      },
    },
  });

  return true;
}

async function resolveOne(ticket: SweepTicket): Promise<boolean> {
  // skip if a reply raced in after the warning; evaluated against the pre-update row
  const freshnessGuard = sql`NOT EXISTS (
    SELECT 1 FROM support_ticket_messages m
    WHERE m.ticket_id = ${supportTicketTable.id}
      AND m.author_kind = 'user' AND m.author_user_id IS NOT NULL
      AND m.is_internal_note = false AND m.deleted_at IS NULL
      AND m.created_at > ${supportTicketTable.auto_resolve_warned_at}
  )`;
  const updated = await markTicketResolved({
    ticketId: ticket.id,
    resolvedByUserId: null,
    extraWhere: freshnessGuard,
  });
  if (!updated) return false;

  try {
    await writeAudit({
      actor_id: ticket.user_id,
      action: "support_ticket.auto_resolved",
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      old_value: null,
      new_value: {
        status: "resolved",
        resolved_by_user_id: null,
        via: "auto-resolve-cron",
      },
      sensitive: false,
      public_message: `Ticket #${updated.id} auto-resolved after inactivity`,
      change_summary: updated.subject,
    });
  } catch (err) {
    console.error("[cron-auto-resolve] audit auto-resolved failed", updated.id, err);
  }

  await fanOutResolveSideEffects(updated, {
    resolvedByName: "Capybara (auto)",
    resolvedByUserId: null,
    publicThreadText:
      ":white_check_mark: This ticket has been automatically marked resolved " +
      "after a period of inactivity. If you still need help, reply here within 7 " +
      "days to reopen it.",
    notifyBody:
      "Your support ticket was automatically marked resolved after a period of " +
      "inactivity. Rate the response or reply if you still need help.",
  });
  return true;
}

export async function runAutoResolveSweep(
  now?: Date,
): Promise<AutoResolveSweepResult> {
  const nowMs = (now ?? new Date()).getTime();
  const warnCutoffIso = new Date(
    nowMs - AUTO_RESOLVE_WARNING_AFTER_MS,
  ).toISOString();
  const resolveCutoffIso = new Date(
    nowMs - AUTO_RESOLVE_AFTER_WARNING_MS,
  ).toISOString();

  const result: AutoResolveSweepResult = {
    cleared: 0,
    warned: 0,
    resolved: 0,
    errors: 0,
  };

  try {
    result.cleared = await clearStaleWarnings();
  } catch (err) {
    console.error("[cron-auto-resolve] clear phase failed", err);
    result.errors++;
  }

  let resolveCandidates: SweepTicket[] = [];
  try {
    resolveCandidates = await findResolveCandidates(resolveCutoffIso);
  } catch (err) {
    console.error("[cron-auto-resolve] resolve scan failed", err);
    result.errors++;
  }
  for (const ticket of resolveCandidates) {
    try {
      if (await resolveOne(ticket)) result.resolved++;
    } catch (err) {
      console.error("[cron-auto-resolve] resolve failed", ticket.id, err);
      result.errors++;
    }
  }

  let warnCandidates: SweepTicket[] = [];
  try {
    warnCandidates = await findWarnCandidates(warnCutoffIso);
  } catch (err) {
    console.error("[cron-auto-resolve] warn scan failed", err);
    result.errors++;
  }
  for (const ticket of warnCandidates) {
    try {
      if (await warnOne(ticket)) result.warned++;
    } catch (err) {
      console.error("[cron-auto-resolve] warn failed", ticket.id, err);
      result.errors++;
    }
  }

  return result;
}
