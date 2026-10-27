// Reloads when a tab from an old deploy fails to import a replaced chunk, which would render blank.
// The sessionStorage cooldown prevents a reload loop when reloading doesn't fix it.

const RELOAD_KEY = "chunk-reload-at";

// Stale-chunk/import failure messages across browsers.
const CHUNK_ERROR_RE =
  /Couldn't resolve component|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload|ChunkLoadError|Loading chunk [\w-]+ failed|reading 'default'|access property "default"/i;

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === "string"
      ? err
      : typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  return CHUNK_ERROR_RE.test(message);
}

export default defineNuxtPlugin((nuxtApp) => {
  const reload = (reason: string, error?: unknown) => {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 10_000) { // reload loop cooldown
      console.error(
        `[chunk-reload] skipping reload (${reason}): recent reload still in cooldown`,
        error,
      );
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    console.warn(`[chunk-reload] reloading tab (${reason})`, error);
    window.location.reload();
  };

  // These only fire for chunk/preload failures.
  nuxtApp.hook("app:chunkError", ({ error }) => {
    reload("app:chunkError", error);
  });
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reload("vite:preloadError", (event as CustomEvent).detail);
  });

  // These also carry normal app errors, so only reload on a chunk-error message.
  nuxtApp.hook("vue:error", (error) => {
    if (isChunkLoadError(error)) reload("vue:error", error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      reload("unhandledrejection", event.reason);
    }
  });
});
