// Slack failures are non-fatal: the in-app fan-out is authoritative and never rolls back.

import { and, eq, sql } from "drizzle-orm";
import { useRuntimeConfig } from "#imports";

import db from "../db";
import { announcementTable, notificationTable, users } from "../db/schema";
import { writeAudit } from "./audit";
import { CAPYBARA_USERNAME } from "./support-ticket-embedding";
import { fetchSlackHandle, fetchSlackProfile } from "./slack";
import { dm, postMessage, updateMessage } from "./slack-bot";
import { translateAnnouncement } from "./translate-announcement";

// Shared with the internal announcements handler so both validate input identically.
export const TITLE_MAX = 200;
export const BODY_MAX = 20_000;

// Rows per INSERT, well under Postgres' bind-parameter ceiling.
const CHUNK_SIZE = 1000;

export type BroadcastResult = {
  announcementId: number;
  recipientCount: number;
  slackTs: string | null;
  slackSkipped?: string;
};

function bulletinChannel(): string | null {
  const config = useRuntimeConfig();
  const ch = config.slackMacondoBulletinChannelId as string | undefined;
  return ch && ch.length > 0 ? ch : null;
}

// Shared by the initial post and later edits so an edited message keeps the same layout.
function buildAnnouncementSlackPayload(
  titleEn: string,
  bodyEn: string,
  imageUrl?: string | null,
): { sectionText: string; blocks: Record<string, unknown>[] } {
  const heading = `*${titleEn}*`;
  const bodyText = mdToSlackText(bodyEn);
  const sectionText = bodyText ? `${heading}\n${bodyText}` : heading;
  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: sectionText } },
  ];
  if (imageUrl) {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: titleEn.slice(0, 1900) || "image", // slack caps alt_text at 2000 chars
    });
  }
  return { sectionText, blocks };
}

// Slack keeps the original sender identity on edit, so no re-spoof is needed.
export async function updateAnnouncementSlackMessage(
  announcementId: number,
  args: { title: string; body: string; imageUrl?: string | null },
): Promise<boolean> {
  const [row] = await db
    .select({
      channel: announcementTable.slack_channel_id,
      ts: announcementTable.slack_message_ts,
    })
    .from(announcementTable)
    .where(eq(announcementTable.id, announcementId))
    .limit(1);
  if (!row?.channel || !row?.ts) return false;

  const { sectionText, blocks } = buildAnnouncementSlackPayload(
    args.title.trim(),
    args.body.trim(),
    args.imageUrl,
  );
  const res = await updateMessage({
    channel: row.channel,
    ts: row.ts,
    text: sectionText,
    blocks,
  });
  if (!res.ok) {
    console.error("[announcements] slack update failed", res.error);
    return false;
  }
  return true;
}

// read_at is left alone: users who dismissed the popup aren't re-pinged, but the bell
// still shows the corrected copy.
export async function updateAnnouncementNotifications(args: {
  announcementId: number;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
}): Promise<number> {
  const titleEn = args.title.trim();
  const bodyEn = args.body.trim();
  const { title_es: titleEs, body_es: bodyEs } = await translateAnnouncement(titleEn, bodyEn);

  await db
    .update(announcementTable)
    .set({ title_en: titleEn, body_en: bodyEn, title_es: titleEs, body_es: bodyEs })
    .where(eq(announcementTable.id, args.announcementId));

  // A correlated subquery keeps this to two statements regardless of recipient count
  // (no bind-parameter blow-up).
  const spanishUser = sql`EXISTS (SELECT 1 FROM ${users} u WHERE u.id = ${notificationTable.user_id} AND lower(coalesce(u.locale, '')) LIKE 'es%')`;
  const base = and(
    eq(notificationTable.type, "admin_announcement"),
    eq(notificationTable.entity_type, args.entityType),
    eq(notificationTable.entity_id, args.entityId),
  );

  const esRows = await db
    .update(notificationTable)
    .set({ title: titleEs, body: bodyEs })
    .where(and(base, spanishUser))
    .returning({ id: notificationTable.id });
  const enRows = await db
    .update(notificationTable)
    .set({ title: titleEn, body: bodyEn })
    .where(and(base, sql`NOT ${spanishUser}`))
    .returning({ id: notificationTable.id });

  return esRows.length + enRows.length;
}

// Best-effort: handles the common cases the site renders; anything else passes through degraded.
function mdToSlackText(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")
    .replace(/^#{1,6}\s+/gm, "");
}

export async function broadcastAnnouncement(args: {
  title: string;
  body: string;
  toSite: boolean;
  toSlack: boolean;
  // null = the Capybara bot when capybara is true, otherwise the plain bot.
  asAuthorUserId: string | null;
  capybara?: boolean;
  entity?: { type: string; id: string };
  imageUrl?: string | null;
  actorId: string;
}): Promise<BroadcastResult> {
  const titleEn = args.title.trim();
  const bodyEn = args.body.trim();

  // Slack is English-only, so a Slack-only post skips the translator.
  let titleEs = titleEn;
  let bodyEs = bodyEn;
  if (args.toSite) {
    const t = await translateAnnouncement(titleEn, bodyEn);
    titleEs = t.title_es;
    bodyEs = t.body_es;
  }

  const [announcement] = await db
    .insert(announcementTable)
    .values({
      title_en: titleEn,
      body_en: bodyEn,
      title_es: titleEs,
      body_es: bodyEs,
      created_by: args.asAuthorUserId ?? args.actorId,
      posted_to_site: args.toSite,
      author_spoofed: args.asAuthorUserId != null,
    })
    .returning({ id: announcementTable.id });
  if (!announcement) {
    throw new Error("Failed to create announcement row");
  }
  const announcementId = announcement.id;
  const entityType = args.entity?.type ?? "announcement";
  const entityId = args.entity?.id ?? String(announcementId);

  let recipientCount = 0;
  if (args.toSite) {
    const rows = (
      await db
        .select({ id: users.id, locale: users.locale })
        .from(users)
        .where(sql`${users.is_temp} IS NOT TRUE`)
    ).map((u) => {
      const isSpanish = (u.locale ?? "").toLowerCase().startsWith("es");
      return {
        user_id: u.id,
        type: "admin_announcement" as const,
        title: isSpanish ? titleEs : titleEn,
        body: isSpanish ? bodyEs : bodyEn,
        entity_type: entityType,
        entity_id: entityId,
        action_url: null,
      };
    });
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db.insert(notificationTable).values(rows.slice(i, i + CHUNK_SIZE));
    }
    recipientCount = rows.length;
    await db
      .update(announcementTable)
      .set({ recipient_count: recipientCount })
      .where(eq(announcementTable.id, announcementId));
  }

  // #macondo-bulletin in prod, the author's DM in dev so testing never spams the channel.
  let slackTs: string | null = null;
  let slackSkipped: string | undefined;
  if (args.toSlack) {
    let spoof: { username?: string; icon_url?: string } = {};
    let authorSlackId: string | null = null;
    if (args.asAuthorUserId) {
      const [author] = await db
        .select({
          username: users.username,
          image: users.image,
          slack_id: users.slack_id,
        })
        .from(users)
        .where(eq(users.id, args.asAuthorUserId))
        .limit(1);
      if (author) {
        authorSlackId = author.slack_id ?? null;
        let username = author.username ?? undefined;
        let iconUrl = author.image ?? undefined;
        // username comes from a prod-only cron, so it can be null on dev or for never-synced
        // accounts. Fetch it (and the avatar) live rather than fall back to the email.
        if (author.slack_id) {
          if (!username) {
            try {
              username = (await fetchSlackHandle(author.slack_id)) ?? undefined;
            } catch {
              /* best-effort */
            }
          }
          if (!iconUrl) {
            try {
              iconUrl = (await fetchSlackProfile(author.slack_id)).image ?? undefined;
            } catch {
              /* best-effort */
            }
          }
        }
        spoof = { username, icon_url: iconUrl };
      }
    } else if (args.capybara) {
      spoof = { username: CAPYBARA_USERNAME };
    }

    const { sectionText, blocks } = buildAnnouncementSlackPayload(
      titleEn,
      bodyEn,
      args.imageUrl,
    );

    let res: Awaited<ReturnType<typeof postMessage>> | null = null;
    if (process.env.NODE_ENV === "production") {
      const channel = bulletinChannel();
      if (!channel) {
        slackSkipped = "no bulletin channel configured";
      } else {
        res = await postMessage({ channel, text: sectionText, blocks, ...spoof });
      }
    } else if (authorSlackId) {
      res = await dm({ user: authorSlackId, text: sectionText, blocks, ...spoof });
    } else {
      slackSkipped = "dev DM skipped: author has no slack_id";
    }

    if (res?.ok) {
      slackTs = res.ts;
      await db
        .update(announcementTable)
        .set({
          slack_channel_id: res.channel ?? null,
          slack_message_ts: res.ts,
          posted_to_slack_at: new Date(),
        })
        .where(eq(announcementTable.id, announcementId));
    } else if (res) {
      slackSkipped = res.error;
      console.error("[announcements] slack post failed", res.error);
    }
  }

  try {
    await writeAudit({
      actor_id: args.actorId,
      action: "announcement_broadcast",
      entity_type: "announcement",
      entity_id: String(announcementId),
      new_value: {
        title_en: titleEn,
        recipient_count: recipientCount,
        translated_to_spanish: bodyEs !== bodyEn,
        posted_to_slack: slackTs != null,
        slack_only: !args.toSite,
        as_author_user_id: args.asAuthorUserId,
        origin_entity_type: args.entity?.type ?? null,
        origin_entity_id: args.entity?.id ?? null,
      },
      change_summary: `Broadcast announcement "${titleEn}"${
        args.toSite ? ` to ${recipientCount} users` : " (Slack only)"
      }`,
    });
  } catch (err) {
    console.error("[announcements] writeAudit failed", err);
  }

  return { announcementId, recipientCount, slackTs, slackSkipped };
}
