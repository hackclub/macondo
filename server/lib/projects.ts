import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import db from "../db";
import { dailyProjectActivityTable, journalsTable, projectCollaboratorTable, projectTable } from "../db/schema";

const isLiveProjectWhere = isNull(projectTable.deleted_at);

export async function getProjects(userId: string) {
  // Owned plus joined projects. DISTINCT is a safety belt; the join shouldn't
  // duplicate rows since owners can't invite themselves.
  const projects = (
    await db
      .selectDistinct({ project: projectTable })
      .from(projectTable)
      .leftJoin(
        projectCollaboratorTable,
        and(
          eq(projectCollaboratorTable.project_id, projectTable.id),
          eq(projectCollaboratorTable.user_id, userId),
          eq(projectCollaboratorTable.status, "active"),
        ),
      )
      .where(
        and(
          or(
            eq(projectTable.user_id, userId),
            eq(projectCollaboratorTable.user_id, userId),
          ),
          isLiveProjectWhere,
        ),
      )
      .orderBy(projectTable.created_at)
  ).map((r) => r.project);

  if (projects.length === 0) return [];

  // journals_hours_sum is the caller's own journals so teammates don't inflate
  // personal stats; journals_hours_total covers all members.
  const projectIds = projects.map((p) => p.id);
  const hoursExpr = sql`COALESCE(${journalsTable.override_hours}, ${journalsTable.hours}, 0)`;
  const hoursRows = await db
    .select({
      project_id: journalsTable.project_id,
      own_hours:
        sql<number>`COALESCE(SUM(${hoursExpr}) FILTER (WHERE ${journalsTable.user_id} = ${userId}), 0)`.as(
          "own_hours",
        ),
      total_hours: sql<number>`COALESCE(SUM(${hoursExpr}), 0)`.as("total_hours"),
    })
    .from(journalsTable)
    .where(
      and(
        inArray(journalsTable.project_id, projectIds),
        eq(journalsTable.archived, false),
      ),
    )
    .groupBy(journalsTable.project_id);

  const hoursByProject = new Map<number, { own: number; total: number }>();
  for (const row of hoursRows) {
    hoursByProject.set(row.project_id, {
      own: Number(row.own_hours ?? 0),
      total: Number(row.total_hours ?? 0),
    });
  }

  // The caller's own Hackatime time, so collaborators' hours show up even when
  // their journals carry 0 hours.
  const hackatimeRows = await db
    .select({
      project_id: dailyProjectActivityTable.project_id,
      seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.hackatime_seconds}), 0)`.as(
        "seconds",
      ),
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        inArray(dailyProjectActivityTable.project_id, projectIds),
      ),
    )
    .groupBy(dailyProjectActivityTable.project_id);

  const hackatimeHoursByProject = new Map<number, number>();
  for (const row of hackatimeRows) {
    hackatimeHoursByProject.set(row.project_id, Number(row.seconds ?? 0) / 3600); // seconds to hours
  }

  return projects.map((p) => ({
    ...p,
    journals_hours_sum: hoursByProject.get(p.id)?.own ?? 0,
    journals_hours_total: hoursByProject.get(p.id)?.total ?? 0,
    hackatime_hours_sum: hackatimeHoursByProject.get(p.id) ?? 0,
  }));
}

export async function getProjectById(id: number) {
  const [project] = await db
    .select()
    .from(projectTable)
    .where(and(eq(projectTable.id, id), isLiveProjectWhere))
    .limit(1);

  return project ?? null;
}

export async function getProjectForMember(userId: string, id: number) {
  const [project] = await db
    .select({ project: projectTable })
    .from(projectTable)
    .leftJoin(
      projectCollaboratorTable,
      and(
        eq(projectCollaboratorTable.project_id, projectTable.id),
        eq(projectCollaboratorTable.user_id, userId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    )
    .where(
      and(
        eq(projectTable.id, id),
        or(
          eq(projectTable.user_id, userId),
          eq(projectCollaboratorTable.user_id, userId),
        ),
        isLiveProjectWhere,
      ),
    )
    .limit(1);

  return project?.project ?? null;
}
