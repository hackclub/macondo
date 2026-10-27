// Every staff-reply path (web, BTS `!message`, public Slack thread) must claim through here,
// since the leaderboard credits the claimer. Guarded on status = 'open' so the first responder keeps it.

import { and, eq } from "drizzle-orm";

import db from "../db";
import { supportTicketTable, users } from "../db/schema";
import { writeAudit } from "./audit";
import { publishStatusChanged } from "./support-ticket-realtime";
import { updateBtsMessage } from "./support-ticket-slack";

export type ClaimVia = "auto_on_reply" | "slack_bang" | "slack_public";

// true only when this call flipped it; side-effect failures are swallowed since the claim is committed
export async function claimIfOpen(
  ticketId: number,
  actorId: string,
  via: ClaimVia,
): Promise<boolean> {
  const [claimed] = await db
    .update(supportTicketTable)
    .set({
      status: "claimed",
      claimed_by_user_id: actorId,
      claimed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(supportTicketTable.id, ticketId),
        eq(supportTicketTable.status, "open"),
      ),
    )
    .returning();
  if (!claimed) return false;

  try {
    await writeAudit({
      actor_id: actorId,
      action: "support_ticket.claimed",
      entity_type: "support_ticket",
      entity_id: String(ticketId),
      old_value: { status: "open" },
      new_value: { status: "claimed", via },
      sensitive: false,
      public_message: `Ticket #${ticketId} auto-claimed on first staff reply`,
      change_summary: claimed.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit auto-claim failed", err);
  }

  // fire-and-forget: a Slack outage must not fail the reply that triggered this
  void (async () => {
    try {
      const [actorRow] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);
      const [authorRow] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, claimed.user_id))
        .limit(1);
      await updateBtsMessage({
        id: claimed.id,
        subject: claimed.subject,
        body: claimed.body,
        status: "claimed",
        priority: claimed.priority,
        category: claimed.category,
        claimed_by_name: actorRow?.name ?? actorRow?.email ?? "staff",
        resolved_by_name: null,
        author_display_name: authorRow?.name ?? null,
        author_avatar_url: null,
        slack_channel_id: claimed.slack_channel_id,
        slack_thread_ts: claimed.slack_thread_ts,
        bts_message_ts: claimed.bts_message_ts,
      });
    } catch (err) {
      console.error("[support-ticket] bts refresh after claim failed", err);
    }
  })();

  void publishStatusChanged(ticketId, claimed.user_id, {
    status: "claimed",
    claimed_by_user_id: actorId,
    actorUserId: actorId,
  });

  return true;
}
