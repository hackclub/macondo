// Gates the catalog endpoint to visitors who loaded a page. Safe to Set-Cookie: documents
// are always no-cache (html-cache-control.ts), so no shared cache replays it.

import { mintUiToken, UI_TOKEN_TTL_MS } from "../lib/ui-token";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:response", (_response, { event }) => {
    const secret = ((useRuntimeConfig().uiGateSecret as string) ?? "").trim();
    if (!secret) return;

    setCookie(event, "mq_ui", mintUiToken(secret), {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production" ||
        getRequestURL(event).protocol === "https:",
      path: "/",
      maxAge: Math.floor(UI_TOKEN_TTL_MS / 1000), // ms to seconds
    });
  });
});
