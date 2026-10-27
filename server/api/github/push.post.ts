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

  const { repo, html, css, readme, projectName } = (await readBody(event)) as {
    repo?: string;
    html?: string;
    css?: string;
    readme?: string;
    projectName?: string;
  };
  if (!repo || !html) {
    throw createError({ statusCode: 400, statusMessage: "Missing repo or html" });
  }

  const displayName = (projectName && projectName.trim())
    || repo.split("/")[1]
    || "My Project";

  let wrappedReadme: string | null = null;
  if (typeof readme === "string" && readme.trim()) {
    const trimmed = readme.trim();
    wrappedReadme = trimmed.startsWith("#")
      ? `${trimmed}\n`
      : `# ${displayName}\n\n${trimmed}\n`;
  }

  const headers = {
    Authorization: `Bearer ${user.github_token}`,
    Accept: "application/vnd.github+json",
  };

  const base64 = (str: string) => Buffer.from(str).toString("base64");

  // github needs the existing sha to update a file; null means it doesn't exist yet
  async function getCurrentSha(path: string): Promise<string | null> {
    try {
      return (
        await $fetch<{ sha: string }>(
          `${GITHUB_API_URL}/repos/${repo}/contents/${path}`,
          { headers },
        )
      )?.sha ?? null;
    } catch {
      return null;
    }
  }

  type PutResponse = { content: { sha: string } };

  async function putFile(
    path: string,
    content: string,
    message: string,
  ): Promise<string | null> {
    const existingSha = await getCurrentSha(path);
    const putBody: Record<string, unknown> = {
      message,
      content: base64(content),
    };
    if (existingSha) putBody.sha = existingSha;
    return (
      await $fetch<PutResponse>(
        `${GITHUB_API_URL}/repos/${repo}/contents/${path}`,
        { method: "PUT", headers, body: putBody },
      )
    )?.content?.sha ?? null;
  }

  const htmlSha = await putFile("index.html", html, "Add index.html");
  let cssSha: string | null = null;
  if (css?.trim()) {
    cssSha = await putFile("style.css", css, "Add style.css");
  }
  if (wrappedReadme) {
    await putFile("README.md", wrappedReadme, "Add README.md");
  }

  try {
    await $fetch(`${GITHUB_API_URL}/repos/${repo}/pages`, {
      method: "POST",
      headers,
      body: {
        source: { branch: "main", path: "/" },
      },
    });
  } catch {
    // 409 = already enabled, which is fine
  }

  const [owner, repoName] = repo.split("/");

  return {
    pages_url: `https://${owner}.github.io/${repoName}/`,
    repo_url: `https://github.com/${repo}`,
    html_sha: htmlSha,
    css_sha: cssSha,
  };
});
