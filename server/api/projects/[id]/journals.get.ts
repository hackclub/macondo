import { resolveViewerLang } from "../../../lib/viewer-language";
import { getProjectById } from "../../../lib/projects";
import { getProjectJournals } from "../../../lib/journals";
import { getSession } from "../../../lib/session";
import { isActiveCollaborator } from "../../../policies/projects";
import { translateJournal } from "../../../lib/translate";

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

  const canEdit = !!user && (user.id === project.user_id || await isActiveCollaborator(user.id, id));
  const journals = await getProjectJournals(id, { includeArchived: canEdit });

  // getProjectJournals() rows are cached and shared across requests: never mutate them in place.
  const query = getQuery(event);
  const cookieLang = getCookie(event, "i18n_locale");
  const viewerLang = resolveViewerLang((typeof query.lang === "string" ? query.lang : undefined) || cookieLang || user?.locale || "en");

  return Promise.all(
    journals.map(async (j) => {
      if (!canEdit || !j.content_language || j.content_language === viewerLang) {
        return j;
      }
      const result = await translateJournal(
        j.id,
        j.content_language,
        viewerLang,
        j.short_brief,
        j.long_brief,
      );
      return {
        ...j,
        short_brief: result.short_brief,
        long_brief: result.long_brief,
        translated_from: j.content_language,
      };
    }),
  );
});
