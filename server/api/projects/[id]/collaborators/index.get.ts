// Public, since the project page shows contributors to everyone; history and management metadata are owner-only.

import { eq } from "drizzle-orm";

import db from "../../../../db";
import {
  projectCollaboratorTable,
  users as usersTable,
} from "../../../../db/schema";
import { getProjectById } from "../../../../lib/projects";
import { getSession } from "../../../../lib/session";
import { canManageProject, MAX_COLLABORATORS } from "../../../../policies/projects";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const project = await getProjectById(id);
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const isOwner = user ? canManageProject(user.id, project) : false;

  // Never select users.name (real-name PII).
  const rows = await db
    .select({
      id: projectCollaboratorTable.id,
      user_id: projectCollaboratorTable.user_id,
      status: projectCollaboratorTable.status,
      joined_at: projectCollaboratorTable.joined_at,
      left_at: projectCollaboratorTable.left_at,
      joined_via: projectCollaboratorTable.joined_via,
      user_username: usersTable.username,
      user_slack_id: usersTable.slack_id,
      user_image: usersTable.image,
    })
    .from(projectCollaboratorTable)
    .leftJoin(usersTable, eq(usersTable.id, projectCollaboratorTable.user_id))
    .where(eq(projectCollaboratorTable.project_id, project.id));

  return {
    owner_id: project.user_id,
    is_owner: isOwner,
    // Same cap the redeem endpoint enforces, so the UI doesn't hardcode it.
    max_collaborators: MAX_COLLABORATORS,
    collaborators: (isOwner ? rows : rows.filter((r) => r.status === "active")).map((r) => ({
      id: isOwner ? r.id : undefined,
      user_id: r.user_id,
      status: r.status,
      joined_at: isOwner ? r.joined_at : undefined,
      left_at: isOwner ? r.left_at : undefined,
      joined_via: isOwner ? r.joined_via : undefined,
      username: r.user_username,
      slack_id: r.user_slack_id,
      image: r.user_image,
    })),
  };
});
