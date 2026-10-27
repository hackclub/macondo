import { getSession } from "~~/server/lib/session";
import { evaluateAchievements } from "~~/server/lib/achievements";

// Read-time evaluation: crossing a threshold unlocks and persists the achievement on this call.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const { stats, achievements } = await evaluateAchievements(
    user.id,
    user.timezone,
  ).then((r) => ({ stats: r.stats, achievements: r.states }));

  return { stats, achievements };
});
