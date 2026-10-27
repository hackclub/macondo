// HARD account ban, distinct from shadow bans: blocks app access and kicks the
// user from the main Slack channel on every rejoin.

import { and, desc, eq } from "drizzle-orm";

import db from "../db";
import { macondoBanTable } from "../db/schema";
import { kickFromReviewChannel, reviewDm } from "./review-slack-bot";
import { useRuntimeConfig } from "#imports";

export type ActiveMacondoBan = typeof macondoBanTable.$inferSelect;

// Expired temp bans are skipped here, so they self-expire with no cron sweep.
export async function getActiveMacondoBan(
  userId: string,
): Promise<ActiveMacondoBan | null> {
  const rows = await db
    .select()
    .from(macondoBanTable)
    .where(
      and(eq(macondoBanTable.user_id, userId), eq(macondoBanTable.active, true)),
    )
    .orderBy(desc(macondoBanTable.created_at));

  const now = Date.now();
  for (const row of rows) {
    if (row.expires_at && row.expires_at.getTime() <= now) continue;
    return row;
  }
  return null;
}

// percent is 0-100. Only set on the initial ban write, never on rejoin.
export type BanGoldPenalty = {
  percent: number;
  removed: number;
  remaining: number;
};

function banMessage(
  reason: string,
  expiresAt: Date | null,
  gold?: BanGoldPenalty | null,
): string {
  const head = expiresAt
    ? `You've been temporarily banned from Macondo until ${expiresAt.toUTCString()}.`
    : "You've been permanently banned from Macondo.";
  let msg = `${head}\n\n*Reason:* ${reason}`;
  if (gold && gold.removed > 0) {
    msg += `\n\nAs of this, ${gold.percent}% of your gold (${gold.removed} gold) has been removed following to this ban. You have ${gold.remaining} gold remaining.`;
  }
  return `${msg}\n\nIf you believe this is a mistake, reach out to the Macondo team.`;
}

// Idempotent and never throws: Slack outages must not block the ban write or
// the rejoin webhook ack.
export async function enforceMacondoBanInSlack(args: {
  slackId: string | null | undefined;
  reason: string;
  expiresAt: Date | null;
  dm?: boolean;
  gold?: BanGoldPenalty | null;
}): Promise<void> {
  const slackId = args.slackId?.trim();
  if (!slackId) return;

  const config = useRuntimeConfig();
  const channel = config.slackMacondoMainChannelId as string | undefined;

  try {
    if (channel) {
      const res = await kickFromReviewChannel({ channel, user: slackId });
      if (!res.ok) {
        // Expected when the user is already gone.
        const benign = new Set([
          "not_in_channel",
          "user_not_found",
          "cant_kick_self",
          "channel_not_found",
        ]);
        if (!benign.has(res.error)) {
          console.warn(`[macondo-ban] kick failed for ${slackId}: ${res.error}`);
        }
      }
    }

    if (args.dm !== false) {
      const dm = await reviewDm({
        user: slackId,
        text: banMessage(args.reason, args.expiresAt, args.gold),
      });
      if (!dm.ok) {
        console.warn(`[macondo-ban] ban DM failed for ${slackId}: ${dm.error}`);
      }
    }
  } catch (err) {
    console.error("[macondo-ban] enforceMacondoBanInSlack error", err);
  }
}
