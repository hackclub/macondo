// Deliberately NOT the ingest scheme (a bare body HMAC): the timestamp is folded into the signed
// string so it can't be rewritten. Pure so it unit-tests without a Nuxt runtime.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Purely the cryptographic match; replay handling lives in the inbound processor's dedup. */
export function ariOutboundSignatureMatches(
  secret: string | null | undefined,
  rawBody: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  deliveryId: string | null | undefined,
): boolean {
  if (!secret || !signature || !timestamp || !deliveryId) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${rawBody}`, "utf8")
    .digest("hex");
  const got = Buffer.from(signature.trim().toLowerCase());
  const exp = Buffer.from(expected);
  if (got.length !== exp.length) return false;
  try {
    return timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}
