import { reportClientError } from "~/utils/reportClientError";

// The Nitro error hook only sees server 5xx, so client errors are beaconed here.
// Dedup and cap live in reportClientError, so three sources can't multiply into log spam.

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("vue:error", (error, _instance, info) => {
    const err = error as { message?: string; stack?: string } | undefined;
    reportClientError({
      source: "vue:error",
      message: err?.message ?? String(error),
      stack: err?.stack ?? "",
      info,
    });
  });

  window.addEventListener("error", (event) => {
    const err = event.error as { message?: string; stack?: string } | undefined;
    reportClientError({
      source: "window",
      message: err?.message ?? event.message ?? "window error",
      stack: err?.stack ?? "",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string; stack?: string } | undefined;
    reportClientError({
      source: "unhandledrejection",
      message: reason?.message ?? String(event.reason),
      stack: reason?.stack ?? "",
    });
  });
});
