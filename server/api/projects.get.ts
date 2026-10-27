import { getProjects } from "../lib/projects";
import { getSession } from "../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return getProjects(user.id);
});
