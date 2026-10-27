import { getSession } from "~~/server/lib/session";
import { GITHUB_API_URL } from "~~/server/lib/api-urls";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  if (!user.github_token) {
    throw createError({ statusCode: 400, statusMessage: "GitHub not connected" });
  }

  try {
    const ghUser = await $fetch<{ login: string; avatar_url: string }>(
      `${GITHUB_API_URL}/user`,
      {
        headers: {
          Authorization: `Bearer ${user.github_token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    return { username: ghUser.login, avatar: ghUser.avatar_url };
  } catch {
    throw createError({
      statusCode: 401,
      statusMessage: "GitHub token expired. Reconnect GitHub to continue.",
    });
  }
});
