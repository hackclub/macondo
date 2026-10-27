import type { projectTable } from "../db/schema";

// Public output is an allowlist: adding a private database column must never
// silently publish it through the anonymous project API.
export function publicProject(project: typeof projectTable.$inferSelect) {
  return {
    id: project.id,
    user_id: project.user_id,
    name: project.name,
    type: project.type,
    description: project.description,
    fruit: project.fruit,
    level: project.level,
    stage: project.stage,
    demo_url: project.demo_url,
    thumbnail_url: project.thumbnail_url,
    repository_url: project.repository_url,
    is_fork: project.is_fork,
    guide: project.guide,
    project_streak_days: project.project_streak_days,
    last_worked_date: project.last_worked_date,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}
