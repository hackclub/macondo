import { and, between, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../../../db";
import {
  dailyProjectActivityTable,
  projectCollaboratorTable,
  projectTable,
  streakDaysTable,
  users,
} from "../../../db/schema";
import { getSession } from "../../../lib/session";
import { dayQualifiesForProjectStreak, streakDayKey } from "../../../lib/streaks";
import { isActiveCollaborator } from "../../../policies/projects";

function startOfMonth(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid month format" });
  }
  return `${month}-01`;
}

function endOfMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) throw createError({ statusCode: 401, statusMessage: "Not authenticated" });

  const projectId = Number(getRouterParam(event, "id"));
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const [project] = await db
    .select({
      user_id: projectTable.user_id,
      auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
      hackatime_projects: projectTable.hackatime_projects,
    })
    .from(projectTable)
    .where(and(eq(projectTable.id, projectId), isNull(projectTable.deleted_at)))
    .limit(1);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  if (!(project.user_id === user.id || await isActiveCollaborator(user.id, projectId))) throw createError({ statusCode: 403, statusMessage: "Not allowed" });

  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, project.user_id))
    .limit(1);
  const memberRows = await db
    .select({ user_id: projectCollaboratorTable.user_id })
    .from(projectCollaboratorTable)
    .where(
      and(
        eq(projectCollaboratorTable.project_id, projectId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    );
  const memberIds = [...new Set([project.user_id, ...memberRows.map((row) => row.user_id)])];
  const memberProjects = await db
    .select({ id: projectTable.id, hackatime_projects: projectTable.hackatime_projects })
    .from(projectTable)
    .where(and(inArray(projectTable.user_id, memberIds), isNull(projectTable.deleted_at)));
  const projectNames = new Set((project.hackatime_projects ?? []).filter(Boolean));
  const activityProjectIds = memberProjects
    .filter((memberProject) =>
      (memberProject.hackatime_projects ?? []).some((name) => projectNames.has(name)),
    )
    .map((memberProject) => memberProject.id);
  if (!activityProjectIds.includes(projectId)) activityProjectIds.push(projectId);

  const query = getQuery(event);
  const month = typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month)
    ? query.month
    : streakDayKey(new Date(), owner?.timezone).slice(0, 7);
  const startDay = startOfMonth(month);
  const endDay = endOfMonth(month);

  const [activity, userDays] = await Promise.all([
    db
      .select({
        day: dailyProjectActivityTable.day,
        project_id: dailyProjectActivityTable.project_id,
        journal_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds}), 0)::int`,
        hackatime_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.hackatime_seconds}), 0)::int`,
      })
      .from(dailyProjectActivityTable)
      .where(
        and(
          inArray(dailyProjectActivityTable.project_id, memberProjects.map((memberProject) => memberProject.id)),
          inArray(dailyProjectActivityTable.user_id, memberIds),
          between(dailyProjectActivityTable.day, startDay, endDay),
        ),
      )
      .groupBy(dailyProjectActivityTable.day, dailyProjectActivityTable.project_id),
      db
        .select({
          day: streakDaysTable.day,
          status: streakDaysTable.status,
        })
        .from(streakDaysTable)
        .where(
          and(
            inArray(streakDaysTable.user_id, memberIds),
            between(streakDaysTable.day, startDay, endDay),
          ),
        ),
  ]);
  activity.sort((a, b) => a.day.localeCompare(b.day));

  const activityByDay = new Map<string, {
    journal_seconds: number;
    hackatime_seconds: number;
    frozen_by_other_project: boolean;
  }>();
  for (const row of activity) {
    const current = activityByDay.get(row.day) ?? {
      journal_seconds: 0,
      hackatime_seconds: 0,
      frozen_by_other_project: false,
    };
    if (activityProjectIds.includes(row.project_id)) {
      current.journal_seconds += row.project_id === projectId ? row.journal_seconds : 0;
      current.hackatime_seconds += row.hackatime_seconds;
    } else if (dayQualifiesForProjectStreak({
      liveSeconds: row.hackatime_seconds,
      storedSeconds: row.hackatime_seconds,
      journalSeconds: row.journal_seconds,
    })) {
      current.frozen_by_other_project = true;
    }
    activityByDay.set(row.day, current);
  }
  const statusesByDay = new Map<string, Set<(typeof userDays)[number]["status"]>>();
  for (const row of userDays) {
    const statuses = statusesByDay.get(row.day) ?? new Set();
    statuses.add(row.status);
    statusesByDay.set(row.day, statuses);
  }
  const days = [...new Set([
    ...activity.map((row) => row.day),
    ...userDays
      .filter((row) => row.status !== "active" && row.status !== "pending")
      .map((row) => row.day),
  ])].sort().map((day) => {
    const row = activityByDay.get(day);
    const journalSeconds = row?.journal_seconds ?? 0;
    const hackatimeSeconds = row?.hackatime_seconds ?? 0;
    const globalStatuses = statusesByDay.get(day);
    const status = dayQualifiesForProjectStreak({
      liveSeconds: hackatimeSeconds,
      storedSeconds: hackatimeSeconds,
      journalSeconds,
    })
      ? "active"
      : (globalStatuses?.has("frozen") || row?.frozen_by_other_project) && project.auto_use_streak_freezes
        ? "frozen"
        : globalStatuses?.has("review_protected")
          ? "review_protected"
          : globalStatuses?.has("missed")
            ? "missed"
            : "pending";
    return {
      day,
      status,
      seconds_logged: journalSeconds + hackatimeSeconds,
      had_journal: journalSeconds > 0,
      frozen_by_other_project: status === "frozen" && !!row?.frozen_by_other_project,
    };
  });

  return { month, timezone: owner?.timezone ?? "UTC", days };
});
