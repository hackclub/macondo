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

  const repo = getQuery(event).repo as string;
  if (!repo) {
    throw createError({ statusCode: 400, statusMessage: "Missing repo parameter" });
  }

  const headers = {
    Authorization: `Bearer ${user.github_token}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const deployments = await $fetch<{ status: string }[]>(
      `${GITHUB_API_URL}/repos/${repo}/pages/deployments`,
      { headers },
    ).catch(() => null);

    if (deployments && deployments.length > 0) {
      const latest = deployments[0];
      if (latest && latest.status === "succeed") {
        return { ready: true };
      }
    }

    const pages = await $fetch<{ status: string }>(
      `${GITHUB_API_URL}/repos/${repo}/pages`,
      { headers },
    ).catch(() => null);

    if (pages?.status === "built") {
      return { ready: true };
    }

    return { ready: false };
  } catch {
    return { ready: false };
  }
});
