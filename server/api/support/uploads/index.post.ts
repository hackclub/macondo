import { isAllowedMime, MAX_UPLOAD_BYTES, uploadBuffer, verifyUploadMime } from "../../../lib/hc-cdn";
import { getSession } from "../../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No file provided" });
  }

  const file = formData.find((f) => f.name === "file");
  if (!file || !file.data) {
    throw createError({ statusCode: 400, statusMessage: "No file provided" });
  }

  const mime = file.type || "application/octet-stream";
  if (!isAllowedMime(mime)) {
    throw createError({
      statusCode: 415,
      statusMessage: `File type not allowed: ${mime}`,
    });
  }

  if (file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large (max ${MAX_UPLOAD_BYTES} bytes)`,
    });
  }

  // Magic bytes must match the declared type, so a renamed HTML/EXE can't ride along.
  if (!verifyUploadMime(mime, new Uint8Array(file.data))) {
    throw createError({
      statusCode: 415,
      statusMessage: `File contents do not match the declared type: ${mime}`,
    });
  }

  const result = await uploadBuffer(
    new Uint8Array(file.data),
    file.filename || "upload",
    mime,
  );

  if ("error" in result) {
    throw createError({ statusCode: 502, statusMessage: result.error });
  }

  return {
    url: result.url,
    sha: result.sha,
    filename: file.filename || "upload",
    mime_type: mime,
    size_bytes: file.data.byteLength,
  };
});
