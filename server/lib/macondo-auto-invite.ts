import { eq } from "drizzle-orm";
import db from "../db";
import { users } from "../db/schema";
import { inviteToConversation } from "./slack-bot";

export async function autoInviteToMacondoChannel(userId: string): Promise<void> {
  const config = useRuntimeConfig();
  const channelId = config.slackMacondoMainChannelId as string | undefined;
  if (!channelId) return; // misconfigured environment, fail closed

  const [row] = await db
    .select({
      slack_id: users.slack_id,
      already: users.slack_macondo_auto_invited_at,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return;
  if (row.already) return;
  if (!row.slack_id) return;

  // Stamp before calling Slack so failed invites aren't retried and users who
  // later leave the channel aren't re-added.
  await db
    .update(users)
    .set({ slack_macondo_auto_invited_at: new Date() })
    .where(eq(users.id, userId));

  // Bots can't invite guests/restricted users, so prefer the admin user token.
  const hasUserToken = !!(config.slackUserToken as string | undefined);
  const result = await inviteToConversation({
    channel: channelId,
    users: [row.slack_id],
    asUser: hasUserToken,
  });

  if (!result.ok) {
    if (result.error === "already_in_channel") return; // happy path
    // Timestamp stays stamped; scripts/invite-linked-to-macondo.ts does catch-up.
    console.warn("[macondo-auto-invite] failed", {
      userId,
      slackId: row.slack_id,
      asUser: hasUserToken,
      error: result.error,
    });
    return;
  }

  const perUserErrors = result.errors ?? [];
  if (perUserErrors.length > 0) {
    console.warn("[macondo-auto-invite] per-user error", {
      userId,
      slackId: row.slack_id,
      asUser: hasUserToken,
      error: perUserErrors[0]!.error,
    });
  }
}
