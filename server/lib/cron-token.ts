import { timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";

// The cron token is an admin-equivalent bearer on the endpoints that accept
// it, so the comparison must be timing-safe like every other secret check
// (Slack signatures, ARI signatures, the reauth cookie). Fails closed: no
// configured secret or no header means no cron access.

export function getCronSecret(): string | null {
  const secret = process.env.NUXT_CRON_SECRET || process.env.CRON_SECRET;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

/** Constant-time comparison of the presented `x-cron-token` header against the configured secret. */
export function isValidCronToken(event: H3Event): boolean {
  const secret = getCronSecret();
  const header = getHeader(event, "x-cron-token");
  if (!secret || !header) return false;

  const expected = Buffer.from(secret);
  const presented = Buffer.from(header);
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}
