import { eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable } from "~~/server/db/schema";
import {
  updateAnnouncementNotifications,
  updateAnnouncementSlackMessage,
} from "~~/server/lib/announcements";
import { writeAudit } from "~~/server/lib/audit";
import {
  composeEventAnnouncementBody,
  formatEventForResponse,
} from "~~/server/lib/events";
import { publishEvent } from "~~/server/lib/realtime";
import { canAccessInternalEvents } from "~~/server/policies/internal";

type Body = {
  title?: string;
  description?: string;
  location?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  image_url?: string | null;
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
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

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const set: Record<string, unknown> = { updated_at: new Date() };

  if ("title" in body) {
    const title = (body.title ?? "").trim();
    if (!title) {
      throw createError({ statusCode: 400, statusMessage: "title cannot be empty" });
    }
    if (title.length > 200) {
      throw createError({
        statusCode: 400,
        statusMessage: "title must be at most 200 characters",
      });
    }
    set.title = title;
  }
  if ("description" in body) set.description = (body.description ?? "").trim();
  if ("location" in body) set.location = body.location?.trim() || null;
  if ("image_url" in body) set.image_url = body.image_url?.trim() || null;
  if ("timezone" in body) set.timezone = body.timezone?.trim() || null;
  if ("ends_at" in body) set.ends_at = parseDate(body.ends_at);

  let startsAtChanged = false;
  if ("starts_at" in body) {
    const next = parseDate(body.starts_at);
    set.starts_at = next;
    startsAtChanged =
      (existing.starts_at?.getTime() ?? null) !== (next?.getTime() ?? null);
  }

  const [updated] = await db
    .update(eventTable)
    .set(set)
    .where(eq(eventTable.id, id))
    .returning();

  // a moved start time re-arms reminders, even for attendees already reminded
  if (startsAtChanged) {
    await db
      .update(eventAttendeeTable)
      .set({ reminder_sent_at: null })
      .where(eq(eventAttendeeTable.event_id, id));
  }

  // edit the already-announced slack post in place; never re-announces
  if (updated && updated.status === "published" && updated.announcement_id) {
    const contentChanged =
      "title" in body ||
      "description" in body ||
      "location" in body ||
      "image_url" in body ||
      "timezone" in body ||
      "ends_at" in body ||
      startsAtChanged;
    if (contentChanged) {
      const announcementBody = composeEventAnnouncementBody(updated);
      try {
        await updateAnnouncementSlackMessage(updated.announcement_id, {
          title: updated.title,
          body: announcementBody,
          imageUrl: updated.image_url,
        });
      } catch (err) {
        console.error("[events] slack message update failed", err);
      }
      // the popup and bell read a per-user snapshot from launch, so rewrite it too
      try {
        await updateAnnouncementNotifications({
          announcementId: updated.announcement_id,
          entityType: "event",
          entityId: String(id),
          title: updated.title,
          body: announcementBody,
        });
      } catch (err) {
        console.error("[events] announcement notifications update failed", err);
      }
      void publishEvent("explore", { type: "event_updated", event_id: id });
    }
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_updated",
      entity_type: "event",
      entity_id: String(id),
      old_value: {
        title: existing.title,
        starts_at: existing.starts_at,
        status: existing.status,
      },
      new_value: { ...set, starts_at_changed: startsAtChanged },
      sensitive: false,
      public_message: `Updated event #${id}`,
    });
  } catch (err) {
    console.error("[events] audit update failed", err);
  }

  return formatEventForResponse(updated ?? existing);
});
