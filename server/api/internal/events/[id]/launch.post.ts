import { and, eq, isNull } from "drizzle-orm";

import db from "~~/server/db";
import { eventTable } from "~~/server/db/schema";
import { broadcastAnnouncement } from "~~/server/lib/announcements";
import { writeAudit } from "~~/server/lib/audit";
import { composeEventAnnouncementBody } from "~~/server/lib/events";
import { publishEvent } from "~~/server/lib/realtime";
import { canDecideEventGifts } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const [existing] = await db
    .select()
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }

  // the pending_review + announced_at claim makes this idempotent
  const [claimed] = await db
    .update(eventTable)
    .set({ status: "published", announced_at: new Date(), updated_at: new Date() })
    .where(
      and(
        eq(eventTable.id, id),
        eq(eventTable.status, "pending_review"),
        isNull(eventTable.announced_at),
      ),
    )
    .returning();
  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: "Event is not pending review",
    });
  }

  const result = await broadcastAnnouncement({
    title: claimed.title,
    body: composeEventAnnouncementBody(claimed),
    toSite: true,
    toSlack: true,
    // announce as the creator, not the approving supaadmin
    asAuthorUserId: claimed.created_by,
    entity: { type: "event", id: String(id) },
    imageUrl: claimed.image_url,
    actorId: actor.id,
  });

  await db
    .update(eventTable)
    .set({ announcement_id: result.announcementId })
    .where(eq(eventTable.id, id));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_launched",
      entity_type: "event",
      entity_id: String(id),
      new_value: {
        recipient_count: result.recipientCount,
        announcement_id: result.announcementId,
        slack_ts: result.slackTs,
      },
      sensitive: false,
      public_message: `Launched event #${id} (${claimed.title}) to ${result.recipientCount} users`,
    });
  } catch (err) {
    console.error("[events] audit launch failed", err);
  }

  void publishEvent("explore", { type: "event_launched", event_id: id });

  return {
    ok: true,
    recipient_count: result.recipientCount,
    announcement_id: result.announcementId,
    slack_ts: result.slackTs,
    slack_skipped: result.slackSkipped ?? null,
  };
});
