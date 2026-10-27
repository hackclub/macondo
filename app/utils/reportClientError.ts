// The Nitro error hook only sees server 5xx, so browser-side throws are beaconed here.
// Dedup and a cap stop an error loop from flooding the logs; a logger must never throw.

const seen = new Set<string>();
let sent = 0;

// Stale-chunk failures chunk-reload.client.ts already recovers (keep in sync with its CHUNK_ERROR_RE)
// and by-design Nuxt navigation throws. Keep it narrow so real app bugs still get reported.
const IGNORED_MESSAGE_RE =
  /Couldn't resolve component|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload|ChunkLoadError|Loading chunk [\w-]+ failed|_nuxt\/builds\/meta\/[\w-]+\.json|AsyncData request cancelled by deduplication/i;

export type ClientErrorReport = {
  source: string;
  message?: string;
  stack?: string;
  info?: string;
  statusCode?: number;
};

export function reportClientError(report: ClientErrorReport): void {
  if (!import.meta.client) return;
  try {
    if (sent >= 12) return; // max reports per page load
    const message = String(report.message ?? "").slice(0, 1000); // cap message length
    const stack = String(report.stack ?? "").slice(0, 4000); // cap stack length
    // Injected browser-extension timeout seen in production; not an app failure.
    if (message === 'Window message "chrome: call method" timed out.' &&
        /chrome-extension:\/\//.test(stack)) {
      return;
    }
    // Check the stack too: a wrapped import failure may carry the signature only there.
    if (IGNORED_MESSAGE_RE.test(message) || IGNORED_MESSAGE_RE.test(stack)) {
      return;
    }
    const sig = `${report.source}:${message}:${stack.slice(0, 120)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    sent += 1;

    const body = JSON.stringify({
      source: report.source,
      message,
      stack,
      info: String(report.info ?? "").slice(0, 300), // cap info length
      statusCode: report.statusCode,
      path: window.location.pathname + window.location.search,
    });

    // sendBeacon survives an immediate reload; keepalive fetch is the fallback.
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon || !navigator.sendBeacon("/api/client-errors", blob)) {
      void fetch("/api/client-errors", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Instrumentation must never become the thing that breaks.
  }
}
