import { eq } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const provider = (await readBody<{ provider: string }>(event)).provider;

  if (!["hackclub", "hackatime", "github"].includes(provider)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid provider" });
  }

  const [freshUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!freshUser) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const updates: Record<string, unknown> = {};

  if (provider === "hackclub") {
    // HCA is the identity anchor: unlinking would orphan ships and grants and let the next login
    // mint a new account. The UI hides the button too; this is defense in depth.
    if (freshUser.sub) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Hack Club Auth can't be unlinked once it's linked. It's the anchor identity for your account, your ships, and any funding grants.",
      });
    }
    updates.sub = null;
    updates.slack_id = null;
  } else if (provider === "hackatime") {
    // Hackatime anchors hours and streaks; unlink-relink cycles reset them. Defense in depth, as above.
    throw createError({
      statusCode: 409,
      statusMessage:
        "Hackatime can't be unlinked once it's connected. It anchors your logged hours and streaks. Contact support in #macondo-help if you genuinely need it moved.",
    });
  } else if (provider === "github") {
    updates.github_token = null;
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  return { ok: true };
});
