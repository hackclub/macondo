// Log server failures without request URLs, user identities, or raw error objects.
// Those can contain query secrets, credentials, and upstream request bodies.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", (error) => {
    const statusCode = (error as { statusCode?: number } | null)?.statusCode ?? 500;
    if (statusCode < 500) return;
    console.error("[error-hook] server request failed", {
      statusCode: typeof statusCode === "number" ? statusCode : 500,
    });
  });
});
