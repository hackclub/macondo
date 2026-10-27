import {
  BODY_MAX,
  TITLE_MAX,
  broadcastAnnouncement,
} from "~~/server/lib/announcements";
import { canManageAnnouncements } from "~~/server/policies/internal";

type BroadcastBody = { title?: string; body?: string; slack?: boolean };

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageAnnouncements(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<BroadcastBody>(event).catch(
    () => ({}) as BroadcastBody,
  );
  const titleEn = (body?.title ?? "").trim();
  const bodyEn = (body?.body ?? "").trim();

  if (!titleEn || !bodyEn) {
    throw createError({
      statusCode: 400,
      statusMessage: "title and body are required",
    });
  }
  if (titleEn.length > TITLE_MAX) {
    throw createError({
      statusCode: 400,
      statusMessage: `title must be at most ${TITLE_MAX} characters`,
    });
  }
  if (bodyEn.length > BODY_MAX) {
    throw createError({
      statusCode: 400,
      statusMessage: `body must be at most ${BODY_MAX} characters`,
    });
  }

  const result = await broadcastAnnouncement({
    title: titleEn,
    body: bodyEn,
    toSite: true,
    toSlack: body?.slack !== false,
    asAuthorUserId: actor.id,
    actorId: actor.id,
  });

  return { id: result.announcementId, recipient_count: result.recipientCount };
});
