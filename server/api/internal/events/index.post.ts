import db from "~~/server/db";
import { eventTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { formatEventForResponse } from "~~/server/lib/events";
import { canAccessInternalEvents } from "~~/server/policies/internal";

type Body = {
  title?: string;
  description?: string;
  location?: string;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  image_url?: string;
};

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const title = (body.title ?? "").trim();
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: "title is required" });
  }
  if (title.length > 200) {
    throw createError({
      statusCode: 400,
      statusMessage: "title must be at most 200 characters",
    });
  }

  const [created] = await db
    .insert(eventTable)
    .values({
      title,
      description: (body.description ?? "").trim(),
      location: body.location?.trim() || null,
      image_url: body.image_url?.trim() || null,
      starts_at: parseDate(body.starts_at),
      ends_at: parseDate(body.ends_at),
      timezone: body.timezone?.trim() || null,
      created_by: actor.id,
    })
    .returning();

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create event" });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_created",
      entity_type: "event",
      entity_id: String(created.id),
      new_value: {
        title,
        starts_at: body.starts_at ?? null,
        timezone: body.timezone ?? null,
      },
      sensitive: false,
      public_message: `Created event "${title}"`,
    });
  } catch (err) {
    console.error("[events] audit create failed", err);
  }

  return formatEventForResponse(created);
});
