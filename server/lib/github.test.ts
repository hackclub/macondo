import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type MockConfig = {
  githubToken?: string;
};
let mockConfig: MockConfig = { githubToken: "test-token" };

// mock.module must be called before the dynamic import below.
mock.module("#imports", () => ({
  useRuntimeConfig: () => mockConfig,
}));
// mock.module persists across files in the suite, so a cache-busting query loads the real module.
const githubPath = resolve(dirname(fileURLToPath(import.meta.url)), "github.ts");
const { ghApiUrl, getGitHubApiHeaders } = (await import(
  `${githubPath}?real-github`
)) as typeof import("./github");

describe("ghApiUrl", () => {
  test("builds api.github.com URLs", () => {
    expect(ghApiUrl("/repos/foo/bar")).toBe(
      "https://api.github.com/repos/foo/bar",
    );
    expect(ghApiUrl("/users/octocat/repos")).toBe(
      "https://api.github.com/users/octocat/repos",
    );
  });

  test("normalizes paths missing a leading slash", () => {
    expect(ghApiUrl("repos/foo/bar")).toBe(
      "https://api.github.com/repos/foo/bar",
    );
  });

  test("accepts a fully-qualified api.github.com URL as input", () => {
    expect(ghApiUrl("https://api.github.com/repos/foo/bar")).toBe(
      "https://api.github.com/repos/foo/bar",
    );
  });
});

describe("getGitHubApiHeaders", () => {
  beforeEach(() => {
    mockConfig = { githubToken: "test-token" };
    delete process.env.NUXT_GITHUB_TOKEN;
    delete process.env.GITHUB_API_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    mockConfig = { githubToken: "test-token" };
  });

  test("uses Authorization: Bearer with the configured token", () => {
    mockConfig = { githubToken: "ghp_personal" };
    const headers = getGitHubApiHeaders();
    expect(headers.Authorization).toBe("Bearer ghp_personal");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  test("respects custom Accept header", () => {
    mockConfig = { githubToken: "tok" };
    const headers = getGitHubApiHeaders("application/vnd.github.raw");
    expect(headers.Accept).toBe("application/vnd.github.raw");
  });

  test("omits Authorization when no token is configured", () => {
    mockConfig = {};
    const headers = getGitHubApiHeaders();
    expect(headers.Authorization).toBeUndefined();
  });
});
