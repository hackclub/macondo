import { and, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { projectTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import { isActiveCollaborator } from "~~/server/policies/projects";
import { buildZip } from "~~/server/lib/zip";

function sanitizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/^[-_.]+/, "")
      .replace(/[-_.]+$/, "") || "project"
  );
}

function wrapReadme(name: string, readme: string | null): string {
  const trimmed = (readme ?? "").trim();
  if (!trimmed) {
    return `# ${name}\n`;
  }
  if (trimmed.startsWith("#")) {
    return `${trimmed}\n`;
  }
  return `# ${name}\n\n${trimmed}\n`;
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project id" });
  }

  const [project] = await db
    .select({
      id: projectTable.id,
      user_id: projectTable.user_id,
      name: projectTable.name,
      html_content: projectTable.html_content,
      css_content: projectTable.css_content,
      readme_content: projectTable.readme_content,
    })
    .from(projectTable)
    .where(and(eq(projectTable.id, id), isNull(projectTable.deleted_at)))
    .limit(1);

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }
  if (!(project.user_id === user.id || (await isActiveCollaborator(user.id, id)))) {
    throw createError({ statusCode: 403, statusMessage: "Not your project" });
  }

  const css = project.css_content ?? "";

  const files: { path: string; data: Buffer }[] = [
    { path: "index.html", data: Buffer.from(project.html_content ?? "<!DOCTYPE html>\n<html><body></body></html>\n", "utf8") },
  ];
  if (css.trim()) {
    files.push({ path: "style.css", data: Buffer.from(css, "utf8") });
  }
  files.push({ path: "README.md", data: Buffer.from(wrapReadme(project.name, project.readme_content), "utf8") });

  const zipBuffer = buildZip(files);

  setHeader(event, "Content-Type", "application/zip");
  setHeader(event, "Content-Disposition", `attachment; filename="${sanitizeName(project.name)}.zip"`);
  setHeader(event, "Content-Length", String(zipBuffer.length));
  return zipBuffer;
});
