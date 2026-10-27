import { getSession } from "../lib/session";
import { safeBufferRequest, validateOutboundUrl } from "../policies/projects";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rawUrl = getQuery(event).url as string | undefined;

  if (!rawUrl) {
    throw createError({ statusCode: 400, statusMessage: "Missing URL" });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid URL" });
  }

  const urlError = validateOutboundUrl(parsed);
  if (urlError) {
    throw createError({ statusCode: 400, statusMessage: urlError });
  }

  try {
    const res = await safeBufferRequest(parsed, { method: "GET" });

    if (res.status >= 300 && res.status < 400) {
      throw createError({ statusCode: 400, statusMessage: "Image URL must not redirect" });
    }
    if (res.status < 200 || res.status >= 300) {
      throw createError({ statusCode: res.status, statusMessage: "Failed to fetch image" });
    }

    const rawContentType = res.headers["content-type"];
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType ?? "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() ?? "";

    if (!contentType.startsWith("image/")) {
      throw createError({ statusCode: 415, statusMessage: "URL did not return an image" });
    }

    return { dataUrl: `data:${contentType};base64,${res.body.toString("base64")}` };
  } catch (e: unknown) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    throw createError({ statusCode: 502, statusMessage: "Failed to fetch image" });
  }
});
