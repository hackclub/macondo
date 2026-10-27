import { and, asc, eq, isNotNull } from "drizzle-orm";

import db from "../../../../../db";
import {
  npsResponseRepliesTable,
  npsResponseTable,
  users,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { dm as slackDm } from "../../../../../lib/slack-bot";
import { canAccessInternalStats } from "../../../../../policies/internal";

type ReplyBody = { body?: string };

const MIN_LEN = 3;
const MAX_LEN = 2000;

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid submission id" });
  }

  const text = (await readBody<ReplyBody>(event))?.body?.trim();
  if (!text || text.length < MIN_LEN) {
    throw createError({
      statusCode: 400,
      statusMessage: `Reply must be at least ${MIN_LEN} characters`,
    });
  }
  if (text.length > MAX_LEN) {
    throw createError({
      statusCode: 400,
      statusMessage: `Reply must be at most ${MAX_LEN} characters`,
    });
  }

  const [row] = await db
    .select({
      id: npsResponseTable.id,
      score: npsResponseTable.score,
      user_id: users.id,
      user_name: users.name,
      user_slack_id: users.slack_id,
    })
    .from(npsResponseTable)
    .innerJoin(users, eq(users.id, npsResponseTable.user_id))
    .where(eq(npsResponseTable.id, id))
    .limit(1);

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Submission not found" });
  }

  if (!row.user_slack_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Target user has no Slack id — can't DM them",
    });
  }

  // thread later replies under the earliest one Slack accepted, not as separate top-level DMs
  const [root] = await db
    .select({
      ts: npsResponseRepliesTable.slack_message_ts,
      channel: npsResponseRepliesTable.slack_channel_id,
    })
    .from(npsResponseRepliesTable)
    .where(
      and(
        eq(npsResponseRepliesTable.nps_response_id, id),
        eq(npsResponseRepliesTable.is_inbound, false),
        isNotNull(npsResponseRepliesTable.slack_message_ts),
      ),
    )
    .orderBy(asc(npsResponseRepliesTable.created_at))
    .limit(1);
  const threadRootTs = root?.ts ?? null;

  const [inserted] = await db
    .insert(npsResponseRepliesTable)
    .values({
      nps_response_id: id,
      responder_user_id: actor.id,
      body: text,
      slack_thread_root_ts: threadRootTs,
    })
    .returning({
      id: npsResponseRepliesTable.id,
      created_at: npsResponseRepliesTable.created_at,
    });

  // DM is sent as the staff member, not the bot. The first reply asks the user to
  // answer in-thread because the Slack events webhook matches threaded replies.
  const slackRes = await slackDm({
    user: row.user_slack_id,
    text: threadRootTs
      ? text
      : `${text}\n\n_Please reply in this thread so your response gets linked back to your NPS feedback._`,
    username: actor.username ?? actor.email ?? undefined,
    icon_url: actor.image ?? undefined,
    thread_ts: threadRootTs ?? undefined,
  });

  let slackDelivered = false;
  let slackError: string | null = null;
  if (slackRes.ok) {
    slackDelivered = true;
    await db
      .update(npsResponseRepliesTable)
      .set({
        slack_message_ts: slackRes.ts,
        slack_channel_id: slackRes.channel,
      })
      .where(eq(npsResponseRepliesTable.id, inserted!.id));
  } else {
    slackError = slackRes.error;
    await db
      .update(npsResponseRepliesTable)
      .set({ slack_error: slackRes.error })
      .where(eq(npsResponseRepliesTable.id, inserted!.id));
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "nps.reply",
      entity_type: "nps_response",
      entity_id: String(id),
      old_value: null,
      new_value: {
        reply_id: inserted!.id,
        target_user_id: row.user_id,
        slack_delivered: slackDelivered,
        slack_error: slackError,
      },
      sensitive: false,
      public_message: `NPS reply sent to ${row.user_name ?? row.user_id}`,
      change_summary: null,
    });
  } catch (err) {
    console.error("[nps-reply] audit failed", err);
  }

  return {
    ok: true,
    reply: {
      id: inserted!.id,
      body: text,
      created_at:
        inserted!.created_at instanceof Date
          ? inserted!.created_at.toISOString()
          : String(inserted!.created_at),
      slack_delivered: slackDelivered,
      slack_error: slackError,
      responder: {
        id: actor.id,
        name: actor.name ?? null,
        image: actor.image ?? null,
      },
    },
  };
});
