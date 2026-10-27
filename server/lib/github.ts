import { createHash } from "node:crypto";

import { useRuntimeConfig } from "#imports";
import { GITHUB_API_URL } from "./api-urls";

export type RepositoryCommit = {
  sha: string;
  shortSha: string;
  message: string;
  committedAt: string;
  url: string;
  authorName: string | null;
  // Linked account's `author.id`, not the git author name; null for unlinked / bot / web-edit commits.
  authorGithubId: number | null;
  additions: number;
  deletions: number;
};

export type RepositoryCommitSnapshot = {
  repository: {
    owner: string;
    repo: string;
    url: string;
  };
  commits: RepositoryCommit[];
};

export type ParsedGitHubRepository = {
  owner: string;
  repo: string;
};

type CachedGitHubFailure = {
  statusCode: number | null;
  statusMessage: string;
  message: string | null;
};

type CommitCacheResult =
  | { ok: true; snapshot: RepositoryCommitSnapshot }
  | { ok: false; failure: CachedGitHubFailure };

type CommitCacheEntry = {
  result: CommitCacheResult;
  freshUntil: number;
  expiresAt: number;
};

type GitHubCommitApiItem = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: {
      name: string | null;
      date: string | null;
    } | null;
  };
  // Linked GitHub account, distinct from git `commit.author`; null if the email isn't tied to a user.
  author: {
    id: number | null;
    login: string | null;
  } | null;
};

type GitHubCommitDetailApiItem = {
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
};

const COMMIT_STATS_CHUNK_SIZE = 25;
const COMMIT_CURRENT_UNTIL_BUCKET_MS = 10 * 60 * 1000;

const commitCache = new Map<string, CommitCacheEntry>();
const inflightCommitFetches = new Map<string, Promise<CommitCacheResult>>();

// TTL eviction is read-path only, so cap the repo-keyed caches and evict the oldest on insert.
const GITHUB_CACHE_MAX_ENTRIES = 2000;

function evictOldestEntry(map: Map<string, unknown>) {
  const first = map.keys().next().value;
  if (first !== undefined) map.delete(first);
}

function configuredGitHubToken() {
  const envToken =
    process.env.NUXT_GITHUB_TOKEN ||
    process.env.GITHUB_API_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.githubToken;

  try {
    const config = useRuntimeConfig();
    return ((typeof config.githubToken === "string" ? config.githubToken : undefined) || envToken)?.trim() || undefined;
  } catch {
    return envToken?.trim() || undefined;
  }
}

// Accepts "/repos/..." or a full GITHUB_API_URL url so call sites can migrate incrementally.
export function ghApiUrl(path: string): string {
  let normalized = path;
  if (normalized.startsWith(GITHUB_API_URL)) {
    normalized = normalized.slice(GITHUB_API_URL.length);
  }
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  return `${GITHUB_API_URL}${normalized}`;
}

export function getGitHubApiHeaders(accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = configuredGitHubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Cache partition fingerprint only; never used to store or verify a password.
function hashCachePart(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function commitCacheDateScope(iso: string | null, role: "since" | "until") {
  if (!iso) return null;

  if (role === "until") {
    const timestamp = new Date(iso).getTime();
    if (
      Number.isFinite(timestamp) &&
      Math.abs(Date.now() - timestamp) <= 60 * 60 * 1000 // within an hour of now counts as current
    ) {
      return new Date(
        Math.floor(timestamp / COMMIT_CURRENT_UNTIL_BUCKET_MS) *
          COMMIT_CURRENT_UNTIL_BUCKET_MS,
      ).toISOString();
    }
  }

  return iso;
}

function repositoryCommitCacheKey(params: {
  parsedRepository: ParsedGitHubRepository;
  sinceIso: string | null;
  untilIso: string | null;
}) {
  const token = configuredGitHubToken();
  // Fraud review asks for commits until "now"; bucket it so each page open doesn't miss the cache.
  const windowScope = hashCachePart(JSON.stringify({
    since: commitCacheDateScope(params.sinceIso, "since"),
    until: commitCacheDateScope(params.untilIso, "until"),
    token: token ? hashCachePart(token) : "anonymous",
  }));
  return [
    "github:commits:v2",
    params.parsedRepository.owner.toLowerCase(),
    params.parsedRepository.repo.toLowerCase(),
    windowScope,
  ].join(":");
}

function readCommitCacheEntry(key: string): CommitCacheEntry | null {
  const now = Date.now();
  const memoryEntry = commitCache.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > now) return memoryEntry;
    commitCache.delete(key);
  }
  return null;
}

function writeCommitCacheEntry(key: string, entry: CommitCacheEntry) {
  if (commitCache.size >= GITHUB_CACHE_MAX_ENTRIES && !commitCache.has(key)) {
    evictOldestEntry(commitCache);
  }
  commitCache.set(key, entry);
}

function writeCommitCacheResult(
  key: string,
  result: CommitCacheResult,
  freshSeconds: number,
  staleSeconds: number,
) {
  const now = Date.now();
  writeCommitCacheEntry(key, {
    result,
    freshUntil: now + freshSeconds * 1000,
    expiresAt: now + (freshSeconds + staleSeconds) * 1000,
  });
}

type GitHubErrorLike = {
  statusCode?: number;
  statusMessage?: string;
  message?: string;
  response?: {
    status?: number;
    statusText?: string;
    _data?: { message?: string };
  };
  data?: { message?: string };
};

function normalizeGitHubFailure(error: unknown): CachedGitHubFailure {
  const err = error as GitHubErrorLike;
  const message = err.response?._data?.message ?? err.data?.message ?? err.message ?? null;
  return {
    statusCode: err.statusCode ?? err.response?.status ?? null,
    statusMessage:
      err.statusMessage ||
      err.response?.statusText ||
      message ||
      "GitHub commit history request failed.",
    message,
  };
}

function throwCachedGitHubFailure(failure: CachedGitHubFailure): never {
  throw createError({
    statusCode: failure.statusCode ?? 502,
    statusMessage: failure.statusMessage,
  });
}

async function refreshCommitCacheResult(
  key: string,
  producer: () => Promise<RepositoryCommitSnapshot>,
  staleSuccessEntry?: CommitCacheEntry,
): Promise<CommitCacheResult> {
  const existing = inflightCommitFetches.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      const result: CommitCacheResult = { ok: true, snapshot: await producer() };
      writeCommitCacheResult(
        key,
        result,
        6 * 60 * 60, // fresh for 6 hours
        7 * 24 * 60 * 60, // then served stale for up to 7 days
      );
      return result;
    } catch (error) {
      if (staleSuccessEntry?.result.ok && staleSuccessEntry.expiresAt > Date.now()) {
        writeCommitCacheEntry(key, {
          ...staleSuccessEntry,
          freshUntil: Math.min(
            staleSuccessEntry.expiresAt,
            Date.now() + 5 * 60 * 1000, // retry the stale refresh in 5 minutes
          ),
        });
        return staleSuccessEntry.result;
      }

      const result: CommitCacheResult = {
        ok: false,
        failure: normalizeGitHubFailure(error),
      };
      writeCommitCacheResult(key, result, 5 * 60, 0); // cache failures for 5 minutes
      return result;
    } finally {
      inflightCommitFetches.delete(key);
    }
  })();

  inflightCommitFetches.set(key, work);
  return work;
}

async function cachedRepositoryCommitSnapshot(
  key: string,
  producer: () => Promise<RepositoryCommitSnapshot>,
) {
  const entry = readCommitCacheEntry(key);
  const now = Date.now();

  if (entry) {
    if (entry.freshUntil > now) {
      if (entry.result.ok) return entry.result.snapshot;
      throwCachedGitHubFailure(entry.result.failure);
    }

    if (entry.result.ok) {
      void refreshCommitCacheResult(key, producer, entry);
      return entry.result.snapshot;
    }
  }

  const result = await refreshCommitCacheResult(key, producer);
  if (result.ok) return result.snapshot;
  throwCachedGitHubFailure(result.failure);
}

// Only GitHub gets API-backed features; other providers are parsed but never fetched.
export type RepositoryProvider = "github" | "codeberg";

export type ParsedRepository = {
  provider: RepositoryProvider;
  owner: string;
  repo: string;
};

const REPOSITORY_PROVIDER_HOSTS: Record<string, RepositoryProvider> = {
  "github.com": "github",
  "codeberg.org": "codeberg",
};

// For display and attribution; GitHub API features must use parseGitHubRepositoryUrl.
export function parseRepositoryUrl(
  repositoryUrl: string | null | undefined,
): ParsedRepository | null {
  if (!repositoryUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(repositoryUrl);
    const provider =
      REPOSITORY_PROVIDER_HOSTS[parsedUrl.hostname.toLowerCase()];
    if (!provider) {
      return null;
    }

    const [owner, rawRepo] = parsedUrl.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/");

    if (!owner || !rawRepo) {
      return null;
    }

    const repo = rawRepo.replace(/\.git$/i, "");
    if (!repo) {
      return null;
    }

    return { provider, owner, repo };
  } catch {
    return null;
  }
}

// GitHub-only, so API requests never target a non-GitHub host.
export function parseGitHubRepositoryUrl(
  repositoryUrl: string | null | undefined,
): ParsedGitHubRepository | null {
  const parsed = parseRepositoryUrl(repositoryUrl);
  return parsed && parsed.provider === "github"
    ? { owner: parsed.owner, repo: parsed.repo }
    : null;
}

export async function fetchRepositoryCommits(params: {
  repositoryUrl: string;
  since?: Date | string | null;
  until?: Date | string | null;
}): Promise<RepositoryCommitSnapshot> {
  const parsedRepository = parseGitHubRepositoryUrl(params.repositoryUrl);
  if (!parsedRepository) {
    throw createError({
      statusCode: 400,
      statusMessage: "Project repository URL must be a valid GitHub repository.",
    });
  }

  const untilIso = params.until ? new Date(params.until).toISOString() : null;
  const sinceIso = params.since ? new Date(params.since).toISOString() : null;
  return cachedRepositoryCommitSnapshot(
    repositoryCommitCacheKey({ parsedRepository, sinceIso, untilIso }),
    () =>
      fetchRepositoryCommitsUncached({
        repositoryUrl: params.repositoryUrl,
        parsedRepository,
        sinceIso,
        untilIso,
      }),
  );
}

async function fetchRepositoryCommitsUncached(params: {
  repositoryUrl: string;
  parsedRepository: ParsedGitHubRepository;
  sinceIso: string | null;
  untilIso: string | null;
}): Promise<RepositoryCommitSnapshot> {
  const headers = getGitHubApiHeaders();
  // Capped at 3 pages: each request counts against GitHub's 5000/hr limit.
  const pageResults = await Promise.all(
    [1, 2, 3].map((page) =>
      $fetch<GitHubCommitApiItem[]>(
        ghApiUrl(
          `/repos/${params.parsedRepository.owner}/${params.parsedRepository.repo}/commits`,
        ),
        {
          headers,
          query: {
            per_page: 100,
            page,
            ...(params.untilIso ? { until: params.untilIso } : {}),
            ...(params.sinceIso ? { since: params.sinceIso } : {}),
          },
        },
      ).catch((err) => {
        console.warn(
          "[github] commits page fetch failed",
          params.parsedRepository.owner,
          params.parsedRepository.repo,
          page,
          err instanceof Error ? err.message : err,
        );
        return [] as GitHubCommitApiItem[];
      }),
    ),
  );
  const commits: RepositoryCommit[] = [];
  for (const pageItems of pageResults) {
    if (!pageItems.length) continue;
    commits.push(
      ...pageItems
        .map((commit) => {
          const committedAt = commit.commit.author?.date;
          if (!committedAt) {
            return null;
          }

          return {
            sha: commit.sha,
            shortSha: commit.sha.slice(0, 7),
            message: commit.commit.message.split("\n")[0]?.trim() || commit.sha.slice(0, 7),
            committedAt,
            url: commit.html_url,
            authorName: commit.commit.author?.name ?? null,
            authorGithubId: commit.author?.id ?? null,
            additions: 0,
            deletions: 0,
          } satisfies RepositoryCommit;
        })
        .filter((commit): commit is RepositoryCommit => commit !== null),
    );
  }

  const sinceTimestamp = params.sinceIso ? new Date(params.sinceIso).getTime() : null;
  const untilTimestamp = params.untilIso ? new Date(params.untilIso).getTime() : null;

  const filteredCommits = commits.filter((commit) => {
    const committedAt = new Date(commit.committedAt).getTime();

    if (Number.isNaN(committedAt)) {
      return false;
    }

    if (untilTimestamp != null && committedAt > untilTimestamp) {
      return false;
    }

    if (sinceTimestamp != null && committedAt <= sinceTimestamp) {
      return false;
    }

    return true;
  });

  // The list endpoint lacks diff stats; chunked to cap concurrency, failures fall back to 0/0.
  for (let i = 0; i < filteredCommits.length; i += COMMIT_STATS_CHUNK_SIZE) {
    await Promise.all(
      filteredCommits.slice(i, i + COMMIT_STATS_CHUNK_SIZE).map(async (commit) => {
        try {
          const detail = await $fetch<GitHubCommitDetailApiItem>(
            ghApiUrl(
              `/repos/${params.parsedRepository.owner}/${params.parsedRepository.repo}/commits/${commit.sha}`,
            ),
            { headers },
          );
          commit.additions = Number(detail.stats?.additions ?? 0) || 0;
          commit.deletions = Number(detail.stats?.deletions ?? 0) || 0;
        } catch {
          commit.additions = 0;
          commit.deletions = 0;
        }
      }),
    );
  }

  return {
    repository: {
      ...params.parsedRepository,
      url: params.repositoryUrl,
    },
    commits: filteredCommits,
  };
}
