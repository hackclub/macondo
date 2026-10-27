// Never throws, so a bad template or revoked token can't break an approve/send path.

import { eq } from "drizzle-orm";

import db from "../db";
import {
  notificationChannel,
  notificationDeliveryTable,
  notificationPreferencesTable,
  notificationTable,
  notificationType,
  users,
} from "../db/schema";

import { sendMail } from "./mail";
import { dm as slackDm } from "./slack-bot";
import type { TransactionalMail } from "./mail-templates";

type NotificationType = (typeof notificationType.enumValues)[number];
type NotificationChannel = (typeof notificationChannel.enumValues)[number];

type PrefsShape = {
  ship_decisions?: { in_app?: boolean; slack?: boolean; email?: boolean };
  payouts?: { in_app?: boolean; slack?: boolean; email?: boolean };
  tickets?: { in_app?: boolean; slack?: boolean; email?: boolean };
  events?: { in_app?: boolean; slack?: boolean; email?: boolean };
};

export type NotifyInput = {
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  action_url?: string;
  entity_type?: string;
  entity_id?: string;
  // Skip regardless of prefs (e.g. a ticket reply already arrived via Slack thread).
  skip_channels?: NotificationChannel[];
  email?: TransactionalMail;
  slack?: {
    text: string;
    blocks?: Record<string, unknown>[];
    username?: string;
    icon_url?: string;
  };
};

function categoryFor(type: NotificationType): keyof PrefsShape {
  if (type.startsWith("event")) return "events";
  if (type === "shop_request_upvoted") return "tickets";
  // Keeps shop_order_shipped in payouts so buyers who muted ship decisions hear about it.
  if (type.startsWith("shop_")) return "payouts";
  if (type.includes("grant_")) return "payouts";
  if (type.startsWith("ticket_")) return "tickets";
  return "ship_decisions";
}

function channelEnabled(
  prefs: PrefsShape | null,
  category: keyof PrefsShape,
  channel: NotificationChannel,
): boolean {
  if (!prefs) return true;
  const cat = prefs[category];
  if (!cat) return true;
  const val = cat[channel as keyof typeof cat];
  return val !== false;
}

const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

function nextRetry(attempts: number): Date | null {
  const ms = BACKOFF_MS[attempts - 1];
  if (!ms) return null;
  return new Date(Date.now() + ms);
}

async function runSlack(
  userId: string,
  slack: NonNullable<NotifyInput["slack"]>,
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const [row] = await db
    .select({ slack_id: users.slack_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.slack_id) return { ok: true, skipped: "no slack_id on user" };
  const res = await slackDm({
    user: row.slack_id,
    text: slack.text,
    blocks: slack.blocks,
    username: slack.username,
    icon_url: slack.icon_url,
  });
  if (res.ok) return { ok: true };
  if (res.error === "no slack bot token configured") {
    return { ok: true, skipped: res.error };
  }
  return { ok: false, error: res.error };
}

async function runEmail(
  userId: string,
  email: TransactionalMail,
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.email) return { ok: true, skipped: "no email on user" };
  const res = await sendMail({ to: row.email, ...email } as Parameters<typeof sendMail>[0]);
  if ("skipped" in res && res.skipped) return { ok: true, skipped: res.reason };
  if (res.ok) return { ok: true };
  return { ok: false, error: res.error };
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const [row] = await db
      .insert(notificationTable)
      .values({
        user_id: input.user_id,
        type: input.type,
        title: input.title,
        body: input.body,
        action_url: input.action_url,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
      })
      .returning({ id: notificationTable.id });
    if (!row) return;
    const notificationId = row.id;

    const [prefRow] = await db
      .select({ preferences: notificationPreferencesTable.preferences })
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.user_id, input.user_id))
      .limit(1);
    const prefs = (prefRow?.preferences ?? null) as PrefsShape | null;
    const category = categoryFor(input.type);

    const skip = new Set(input.skip_channels ?? []);
    const channels: NotificationChannel[] = ["in_app", "slack", "email"];

    for (const channel of channels) {
      if (skip.has(channel)) {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel,
          status: "skipped",
          last_error: "skip_channels",
          sent_at: new Date(),
        });
        continue;
      }

      if (!channelEnabled(prefs, category, channel)) {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel,
          status: "skipped",
          last_error: "disabled by user preferences",
          sent_at: new Date(),
        });
        continue;
      }

      if (channel === "in_app") {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel: "in_app",
          status: "sent",
          attempts: 1,
          sent_at: new Date(),
        });
        continue;
      }

      let result: { ok: boolean; error?: string; skipped?: string };
      if (channel === "slack") {
        if (!input.slack) {
          result = { ok: true, skipped: "no slack payload" };
        } else {
          result = await runSlack(input.user_id, input.slack);
        }
      } else if (channel === "email") {
        if (!input.email) {
          result = { ok: true, skipped: "no email payload" };
        } else {
          result = await runEmail(input.user_id, input.email);
        }
      } else {
        result = { ok: true, skipped: "unknown channel" };
      }

      if (result.skipped) {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel,
          status: "skipped",
          last_error: result.skipped,
          sent_at: new Date(),
        });
      } else if (result.ok) {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel,
          status: "sent",
          attempts: 1,
          sent_at: new Date(),
        });
      } else {
        await db.insert(notificationDeliveryTable).values({
          notification_id: notificationId,
          channel,
          status: "failed",
          attempts: 1,
          last_error: result.error ?? "unknown",
          next_retry_at: nextRetry(1),
        });
      }
    }
  } catch (err) {
    console.error("[notify] dispatcher failed", err);
  }
}
