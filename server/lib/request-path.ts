import type { H3Event } from "h3";

// MUST match the router's decoded path: authz keyed off the percent-encoded
// pathname lets `/api/interna%6C/x` slip an `/api/internal` prefix check.
// Security policy matching is case-insensitive, like Nuxt page routing.
export function getRoutedPath(event: H3Event): string {
  const p = event.path || "/";
  const q = p.indexOf("?");
  return (q === -1 ? p : p.slice(0, q)).toLowerCase();
}
