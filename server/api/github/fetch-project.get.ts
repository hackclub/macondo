import { and, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { projectTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import { GITHUB_API_URL } from "~~/server/lib/api-urls";

type GithubContentsResponse = { sha: string; content: string; encoding: string };

async function fetchFile(
  token: string,
  repo: string,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await $fetch<GithubContentsResponse>(
      `${GITHUB_API_URL}/repos/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    return { content: Buffer.from(res.content ?? "", "base64").toString("utf8"), sha: res.sha };
  } catch {
    return null;
  }
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  if (!user.github_token) {
    throw createError({ statusCode: 400, statusMessage: "GitHub not connected" });
  }

  const query = getQuery(event);
  const repo = typeof query.repo === "string" ? query.repo : null;
  const projectIdRaw = typeof query.project_id === "string" ? Number(query.project_id) : null;
  if (!repo) {
    throw createError({ statusCode: 400, statusMessage: "Missing repo parameter" });
  }

  const htmlResult = await fetchFile(user.github_token, repo, "index.html");
  const cssResult = await fetchFile(user.github_token, repo, "style.css");

  let changedSinceTutorial = false;
  if (projectIdRaw && Number.isFinite(projectIdRaw)) {
    const [project] = await db
      .select({
        id: projectTable.id,
        user_id: projectTable.user_id,
        last_html_sha: projectTable.last_html_sha,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectIdRaw),
          eq(projectTable.user_id, user.id),
          isNull(projectTable.deleted_at),
        ),
      )
      .limit(1);
    if (project && htmlResult && project.last_html_sha && htmlResult.sha !== project.last_html_sha) {
      changedSinceTutorial = true;
    }
  }

  return {
    html: htmlResult?.content ?? "",
    css: cssResult?.content ?? "",
    html_sha: htmlResult?.sha ?? null,
    css_sha: cssResult?.sha ?? null,
    has_index: !!htmlResult,
    changed_since_tutorial: changedSinceTutorial,
  };
});
