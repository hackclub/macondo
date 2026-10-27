// Kept free of DB / Nuxt imports so it's unit-testable.

import type { InferInsertModel } from "drizzle-orm";

import type { supportTicketMessageTable } from "../db/schema";

// a Slack user with no linked account: no author_user_id, identity kept in slack_author_* columns
export const SLACK_EXTERNAL_AUTHOR_KIND = "slack_external";

export type ResolvedSlackAuthor = {
  user_id: string | null;
  name: string | null;
  avatar: string | null;
};

type SupportMessageInsert = InferInsertModel<typeof supportTicketMessageTable>;

export function buildMirroredSlackReplyValues(args: {
  ticketId: number;
  slackUserId: string;
  author: ResolvedSlackAuthor;
  body: string;
  slackTs: string | null;
}): SupportMessageInsert {
  const base: SupportMessageInsert = {
    ticket_id: args.ticketId,
    body: args.body,
    is_internal_note: false,
    slack_ts: args.slackTs,
  };

  if (args.author.user_id) {
    return {
      ...base,
      author_user_id: args.author.user_id,
      author_kind: "user",
    };
  }

  return {
    ...base,
    author_user_id: null,
    author_kind: SLACK_EXTERNAL_AUTHOR_KIND,
    slack_author_id: args.slackUserId,
    slack_author_name: args.author.name,
    slack_author_image: args.author.avatar,
  };
}
