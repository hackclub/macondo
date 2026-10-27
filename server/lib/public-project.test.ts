import { expect, test } from "bun:test";
import { publicProject } from "./public-project";

test("anonymous project projection excludes capabilities, private drafts, evidence and future columns", () => {
  const project = {
    id: 42, name: "Example", description: "Public description",
    invite_code: "capability", next_ship_reviewer_note: "private review context",
    cart_screenshots: ["private evidence"], build_cost_cents: 12345,
    hackatime_projects: ["private workspace"], html_content: "private source",
    next_ship_ai_usage_description: "private disclosure", future_private_column: "must stay private",
  } as unknown as Parameters<typeof publicProject>[0];
  const result = publicProject(project);
  expect(result.id).toBe(42);
  expect(result.name).toBe("Example");
  for (const key of ["invite_code", "next_ship_reviewer_note", "cart_screenshots", "build_cost_cents", "hackatime_projects", "html_content", "next_ship_ai_usage_description", "future_private_column"]) {
    expect(result).not.toHaveProperty(key);
  }
});
