// Fire-and-forget safe: errors are caught so a Slack hiccup can't break grant/cancel paths.
// No "invited once" stamp, so a maker who cancels and re-buys gets re-invited.

import { eq } from "drizzle-orm";

import db from "../db";
import { users } from "../db/schema";
import { countValidEventInvitePurchases } from "./certificates";
import { setEventQualifiedFlag } from "./loops";
import { inviteToConversation, kickFromConversation } from "./slack-bot";

function channelId(): string | undefined {
  const config = useRuntimeConfig();
  const id = config.slackEventAttendeeChannelId as string | undefined;
  return id && id.length > 0 ? id : undefined;
}

async function slackIdFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ slack_id: users.slack_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.slack_id ?? null;
}

export async function addUserToEventChannel(userId: string): Promise<void> {
  try {
    const channel = channelId();
    if (!channel) return;
    const slackId = await slackIdFor(userId);
    if (!slackId) return;

    // Bots can't invite guests/restricted users, so prefer the admin user token.
    const config = useRuntimeConfig();
    const asUser = !!(config.slackUserToken as string | undefined);
    const result = await inviteToConversation({
      channel,
      users: [slackId],
      asUser,
    });

    if (!result.ok && result.error !== "already_in_channel") {
      console.warn("[event-channel] invite failed");
      return;
    }
    if (result.ok && (result.errors ?? []).length > 0) {
      console.warn("[event-channel] invite per-user error");
    }
  } catch {
    console.error("[event-channel] addUserToEventChannel failed");
  }
}

// Only acts when no valid invite remains, so cancelling a duplicate order keeps the seat.
export async function removeUserFromEventChannelIfNoInvite(
  userId: string,
): Promise<void> {
  try {
    if ((await countValidEventInvitePurchases(userId)) > 0) return;

    const [row] = await db
      .select({ slack_id: users.slack_id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (row?.email) {
      void setEventQualifiedFlag({
        email: row.email,
        slack_id: row.slack_id,
        qualified: false,
      });
    }

    const channel = channelId();
    if (!channel) return;
    const slackId = row?.slack_id ?? null;
    if (!slackId) return;

    const config = useRuntimeConfig();
    const asUser = !!(config.slackUserToken as string | undefined);
    const result = await kickFromConversation({
      channel,
      user: slackId,
      asUser,
    });

    if (!result.ok && result.error !== "not_in_channel") {
      console.warn("[event-channel] kick failed");
    }
  } catch {
    console.error("[event-channel] removeUserFromEventChannelIfNoInvite failed");
  }
}
