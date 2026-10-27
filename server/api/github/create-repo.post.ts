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

  const rawName = (await readBody(event))?.name?.trim();
  if (!rawName) {
    throw createError({ statusCode: 400, statusMessage: "Repository name is required" });
  }
  const name = rawName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[-_.]+/, "")
    .replace(/[-_.]+$/, "");
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "Invalid repository name" });
  }

  const headers = {
    Authorization: `Bearer ${user.github_token}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const ghUser = await $fetch<{ login: string }>(`${GITHUB_API_URL}/user`, { headers });
    await $fetch(`${GITHUB_API_URL}/repos/${ghUser.login}/${name}`, { headers });
    throw createError({ statusCode: 409, statusMessage: `A repository called "${name}" already exists on your account. Choose a different name.` });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; statusMessage?: string };
    if (e.statusCode === 409) throw err;
    // A 404 means the name is free.
  }

  try {
    const res = await $fetch<{
      full_name: string;
      html_url: string;
      name: string;
    }>(`${GITHUB_API_URL}/user/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.github_token}`,
        Accept: "application/vnd.github+json",
      },
      body: {
        name,
        description: "My personal website",
        auto_init: false,
        private: false,
      },
    });

    return {
      repo: res.full_name,
      html_url: res.html_url,
      name: res.name,
    };
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; statusCode?: number };
    if (e.data?.message?.includes("name already exists")) {
      throw createError({ statusCode: 409, statusMessage: "A repository with that name already exists" });
    }
    throw createError({
      statusCode: e.statusCode || 500,
      statusMessage: e.data?.message || "Failed to create repository",
    });
  }
});
