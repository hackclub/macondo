import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import db from "../../db";
import { journalsTable, projectIdeaTable, projectTable, shipTable } from "../../db/schema";
import { guardAiRequest } from "../../lib/ai-guard";
import { ghApiUrl, getGitHubApiHeaders, parseGitHubRepositoryUrl } from "../../lib/github";
import {
  getAuthenticatedHours,
  getAuthenticatedProjects,
  getLatestHeartbeat,
  isHackatimeBanned,
} from "../../lib/hackatime";
import { getEffectiveHackatimeOAuthToken } from "../../lib/dev-debug-flags";
import {
  generateIdeas,
  type IdeaGenerationExistingProject,
  type IdeaGenerationJournalSnippet,
} from "../../lib/idea-generation";
import { getSession } from "../../lib/session";

const JOURNALS_PER_PROJECT = 3;

interface ProjectRow {
  id: number;
  name: string;
  description: string;
  level: string | null;
  type: string;
  repository_url: string | null;
  readme_content: string | null;
}

async function fetchReadmeForRepo(url: string): Promise<string | null> {
  const parsed = parseGitHubRepositoryUrl(url);
  if (!parsed) return null;

  // the gh proxy ignores Accept: vnd.github.raw, so decode the base64 JSON content
  const headers = getGitHubApiHeaders();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000); // readme fetch timeout, keeps generation snappy
  try {
    const res = await $fetch<{ content?: string; encoding?: string }>(
      ghApiUrl(`/repos/${parsed.owner}/${parsed.repo}/readme`),
      { headers, signal: controller.signal },
    );
    if (!res || typeof res.content !== "string" || !res.encoding) return null;
    const decoded =
      res.encoding === "base64"
        ? Buffer.from(res.content.replace(/\s/g, ""), "base64").toString("utf8")
        : res.content;
    return decoded.length > 0 ? decoded : null;
  } catch (err) {
    console.warn(
      `[ideas/generate] readme fetch failed for ${parsed.owner}/${parsed.repo}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildExistingProjectsContext(
  projects: ProjectRow[],
): Promise<IdeaGenerationExistingProject[]> {
  if (projects.length === 0) return [];

  const journals = await db
    .select({
      project_id: journalsTable.project_id,
      short_brief: journalsTable.short_brief,
      long_brief: journalsTable.long_brief,
      created_at: journalsTable.created_at,
    })
    .from(journalsTable)
    .where(
      and(
        inArray(journalsTable.project_id, projects.map((p) => p.id)),
        eq(journalsTable.archived, false),
      ),
    )
    .orderBy(desc(journalsTable.created_at))
    .limit(projects.length * JOURNALS_PER_PROJECT * 2);

  const journalsByProject = new Map<number, IdeaGenerationJournalSnippet[]>();
  for (const j of journals) {
    const list = journalsByProject.get(j.project_id) ?? [];
    if (list.length < JOURNALS_PER_PROJECT) {
      list.push({ short_brief: j.short_brief, long_brief: j.long_brief });
      journalsByProject.set(j.project_id, list);
    }
  }

  const readmeFetches = projects.map(async (p) => {
    if (p.readme_content) return p.readme_content;
    if (!p.repository_url) return null;
    return fetchReadmeForRepo(p.repository_url);
  });
  const readmes = await Promise.all(readmeFetches);

  return projects.map((p, idx) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    level: p.level,
    type: p.type,
    repository_url: p.repository_url,
    recent_journals: journalsByProject.get(p.id) ?? [],
    readme_excerpt: readmes[idx]?.slice(0, 4000) ?? null, // readme chars; prompt budget beats completeness
  }));
}

const REROLL_CATEGORIES = ["software", "hardware"] as const;
type RerollCategory = (typeof REROLL_CATEGORIES)[number];

const REROLL_DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"] as const;
type RerollDifficulty = (typeof REROLL_DIFFICULTIES)[number];

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const hackatimeToken = getEffectiveHackatimeOAuthToken(
    event,
    user.hackatime_oauth_token,
  );

  if (!hackatimeToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "Link Hackatime first so we can read your coding activity.",
    });
  }

  // a category makes this a reroll (one idea replacing the current suggestion);
  // without one it's the legacy mixed batch
  const body = await readBody<{ category?: unknown; difficulty?: unknown; ignoreHistory?: unknown }>(event).catch(
    () => ({} as { category?: unknown; difficulty?: unknown; ignoreHistory?: unknown }),
  );
  const requestedCategory =
    typeof body.category === "string" && (REROLL_CATEGORIES as readonly string[]).includes(body.category)
      ? (body.category as RerollCategory)
      : null;
  const requestedDifficulty =
    typeof body.difficulty === "string" && (REROLL_DIFFICULTIES as readonly string[]).includes(body.difficulty)
      ? (body.difficulty as RerollDifficulty)
      : null;
  const isReroll = requestedCategory !== null;

  // "ignore my past projects": use total hours only, so only new-project ideas come back
  const ignoreHistory = body.ignoreHistory === true;

  const config = useRuntimeConfig();
  const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;
  if (adminKey) {
    if (
      await isHackatimeBanned({
        adminKey,
        hackatimeId: user.hackatime_id ?? null,
        hackatimeOAuthToken: hackatimeToken,
        email: user.email ?? null,
        userId: user.id,
      })
    ) {
      throw createError({
        statusCode: 403,
        statusMessage: "Idea generation is not available on this account.",
      });
    }
  }

  const guard = await guardAiRequest({
    userId: user.id,
    bucket: "validate",
    payload: "ideas",
    limit: 5,
    windowSeconds: 60,
  });
  if (!guard.ok) {
    throw createError({ statusCode: guard.status, statusMessage: guard.message });
  }

  const [hours, projects, latest, existingProjectsRaw] = await Promise.all([
    getAuthenticatedHours(hackatimeToken),
    getAuthenticatedProjects(hackatimeToken, { includeArchived: false }),
    getLatestHeartbeat(hackatimeToken),
    db
      .select({
        id: projectTable.id,
        name: projectTable.name,
        description: projectTable.description,
        level: projectTable.level,
        type: projectTable.type,
        repository_url: projectTable.repository_url,
        readme_content: projectTable.readme_content,
        hackatime_projects: projectTable.hackatime_projects,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, user.id),
          isNull(projectTable.deleted_at),
        ),
      )
      .orderBy(desc(projectTable.updated_at))
      .limit(8), // recent projects given to the model
  ]);

  // hardware often isn't hackatime-linked, so build context for all and filter by type below
  const fullContext = ignoreHistory
    ? []
    : await buildExistingProjectsContext(existingProjectsRaw);

  // hardware counts as shipped only once the build, not just the design, is approved
  const projectIds = existingProjectsRaw.map((p) => p.id);
  const softwareShippedIds = new Set<number>();
  const hardwareBuiltIds = new Set<number>();
  if (!ignoreHistory && projectIds.length > 0) {
    const shippedRows = await db
      .select({
        project_id: shipTable.project_id,
        is_build_complete_submission: shipTable.is_build_complete_submission,
      })
      .from(shipTable)
      .where(
        and(
          inArray(shipTable.project_id, projectIds),
          inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        ),
      );
    for (const r of shippedRows) {
      softwareShippedIds.add(r.project_id);
      if (r.is_build_complete_submission) hardwareBuiltIds.add(r.project_id);
    }
  }

  // hardware skips the hackatime-link check since build time isn't tracked there
  const rawById = new Map(existingProjectsRaw.map((p) => [p.id, p]));
  const existingProjects = fullContext.filter((p) => {
    const hasJournals = p.recent_journals.length > 0;
    if (!hasJournals) return false;
    if (p.type === "hardware") {
      return hardwareBuiltIds.has(p.id);
    }
    if (!softwareShippedIds.has(p.id)) return false;
    const raw = rawById.get(p.id);
    return Array.isArray(raw?.hackatime_projects) && raw.hackatime_projects.length > 0;
  });

  // only recent or linked hackatime projects, so long-abandoned ones don't skew ideas
  const linkedHackatimeNames = new Set<string>();
  for (const p of existingProjectsRaw) {
    for (const name of p.hackatime_projects ?? []) {
      if (name) linkedHackatimeNames.add(name);
    }
  }
  const recentCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const relevantHackatimeProjects = ignoreHistory
    ? []
    : (projects?.projects ?? []).filter((p) => {
        if (linkedHackatimeNames.has(p.name)) return true;
        if (!p.most_recent_heartbeat) return false;
        const ts = Date.parse(p.most_recent_heartbeat);
        return Number.isFinite(ts) && ts >= recentCutoffMs;
      });

  const totalHours = hours?.total_seconds ? hours.total_seconds / 3600 : 0; // seconds to hours
  if (totalHours < 1) {
    throw createError({
      statusCode: 422,
      statusMessage: "Log at least an hour of Hackatime activity first, then come back.",
    });
  }

  const recentIdeaRows = await db
    .select({
      title: projectIdeaTable.title,
      kind: projectIdeaTable.kind,
      existing_project_id: projectIdeaTable.existing_project_id,
    })
    .from(projectIdeaTable)
    .where(eq(projectIdeaTable.user_id, user.id))
    .orderBy(desc(projectIdeaTable.generated_at))
    .limit(12); // recent ideas to avoid repeating

  // drop projects targeted by the last two update ideas, or rerolls keep latching
  // onto the same strong project
  let candidateExistingProjects = existingProjects;
  if (!ignoreHistory) {
    const recentUpdateTargets = new Set<number>();
    for (const r of recentIdeaRows.slice(0, 2)) {
      if (r.kind === "project_update" && typeof r.existing_project_id === "number") {
        recentUpdateTargets.add(r.existing_project_id);
      }
    }
    if (recentUpdateTargets.size > 0) {
      candidateExistingProjects = existingProjects.filter(
        (p) => !recentUpdateTargets.has(p.id),
      );
    }
  }

  const ideas = await generateIdeas({
    totalHours,
    projects: relevantHackatimeProjects.map((p) => ({
      name: p.name,
      total_seconds: p.total_seconds,
      languages: p.languages ?? [],
    })),
    latestHeartbeat:
      !ignoreHistory && latest
        ? {
            project: latest.project,
            language: latest.language,
            entity: latest.entity,
          }
        : null,
    existingProjects: candidateExistingProjects,
    locale: user.locale ?? "en",
    forceCategory: requestedCategory ?? undefined,
    forceDifficulty: requestedDifficulty ?? undefined,
    count: isReroll ? 1 : undefined,
    recentTitles: recentIdeaRows.map((r) => r.title),
  });

  const now = new Date();

  if (isReroll) {
    await db
      .delete(projectIdeaTable)
      .where(
        and(
          eq(projectIdeaTable.user_id, user.id),
          eq(projectIdeaTable.status, "suggested"),
        ),
      );
  }

  const inserted = await db
    .insert(projectIdeaTable)
    .values(
      ideas.map((idea) => ({
        user_id: user.id,
        title: idea.title,
        description: idea.description,
        reasoning: idea.reasoning || null,
        languages: idea.languages,
        difficulty: idea.difficulty,
        category: idea.category,
        kind: idea.kind,
        existing_project_id: idea.existing_project_id,
        resources: idea.resources,
        status: "suggested" as const,
        generated_at: now,
        created_at: now,
        updated_at: now,
      })),
    )
    .returning();

  return {
    inserted: inserted.length,
    ideas: inserted,
    idea: inserted[0] ?? null,
  };
});
