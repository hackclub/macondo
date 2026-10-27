// Report-only until nonces exist: script-src 'self' would block nuxt's inline
// window.__NUXT__ config script and the tutorial's srcdoc preview (which inherits the policy).

import type { H3Event } from "h3";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

function isHttps(event: H3Event) {
  return (
    process.env.NODE_ENV === "production" ||
    getRequestURL(event).protocol === "https:"
  );
}

export default defineEventHandler((event) => {
  setResponseHeader(event, "Content-Security-Policy-Report-Only", CSP);
  // Enforce the directives that don't require nonces or break tutorial scripts.
  setResponseHeader(event, "Content-Security-Policy", "object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "X-Frame-Options", "SAMEORIGIN");
  setResponseHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");
  setResponseHeader(
    event,
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  // same-origin-allow-popups: OAuth/connector flows may relay via openers
  // without exposing the window reference to cross-origin pages.
  setResponseHeader(event, "Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (isHttps(event)) {
    setResponseHeader(
      event,
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains", // one year
    );
  }
});
