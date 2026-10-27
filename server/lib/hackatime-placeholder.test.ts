// No module mocks: bun's mock.module leaks across files.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isHackatimePlaceholderProjectName,
  stripHackatimePlaceholderProjects,
} from "./hackatime-placeholder";

describe("isHackatimePlaceholderProjectName", () => {
  test("matches the placeholder case-insensitively (mirrors ARI's EqualFold)", () => {
    expect(isHackatimePlaceholderProjectName("<<LAST_PROJECT>>")).toBe(true);
    expect(isHackatimePlaceholderProjectName("<<last_project>>")).toBe(true);
    expect(isHackatimePlaceholderProjectName("<<Last_Project>>")).toBe(true);
    expect(isHackatimePlaceholderProjectName("  <<LAST_PROJECT>>  ")).toBe(true);
  });

  test("leaves real project names alone", () => {
    expect(isHackatimePlaceholderProjectName("Daily Prophet")).toBe(false);
    expect(isHackatimePlaceholderProjectName("last_project")).toBe(false);
    expect(isHackatimePlaceholderProjectName("<<LAST_PROJECT>> journal")).toBe(
      false,
    );
    expect(isHackatimePlaceholderProjectName("")).toBe(false);
  });
});

describe("stripHackatimePlaceholderProjects", () => {
  test("drops placeholder buckets, keeps real projects in order", () => {
    const projects = [
      { name: "<<LAST_PROJECT>>", total_seconds: 4830 },
      { name: "Daily Prophet", total_seconds: 351 },
      { name: "<<last_project>>", total_seconds: 60 },
      { name: "other-repo", total_seconds: 120 },
    ];
    expect(stripHackatimePlaceholderProjects(projects).map((p) => p.name)).toEqual(
      ["Daily Prophet", "other-repo"],
    );
  });

  test("tolerates null/undefined lists", () => {
    expect(stripHackatimePlaceholderProjects(null)).toEqual([]);
    expect(stripHackatimePlaceholderProjects(undefined)).toEqual([]);
  });
});

// Source-read guards: the filter only works while both call sites apply it.
describe("placeholder filter wiring", () => {
  test("getAuthenticatedProjects strips placeholder buckets", () => {
    const src = readFileSync(join(import.meta.dir, "hackatime.ts"), "utf8");
    expect(src.slice(src.indexOf("export async function getAuthenticatedProjects"))).toContain("stripHackatimePlaceholderProjects(response.projects)");
  });
});
