// Rate-limited so the code space can't be cheaply enumerated. A revoked certificate
// returns 200 with valid:false so verifiers learn it was revoked.

import {
  getCertificateByCode,
  toPublicCertificate,
  tryNormalizeCertificateCode,
} from "~~/server/lib/certificates";
import { checkRateLimits } from "~~/server/lib/rate-limit";
import { getSession } from "~~/server/lib/session";

function getIpAddress(event: Parameters<typeof getHeader>[0]): string | null {
  const fwd = getHeader(event, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = getHeader(event, "x-real-ip");
  if (real) return real.trim();
  return (
    event as unknown as {
      node?: { req?: { socket?: { remoteAddress?: string } } };
    }
  ).node?.req?.socket?.remoteAddress ?? null;
}

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const bucketKey = session ? session.id : getIpAddress(event);
  if (bucketKey) {
    // Generous for normal viewing (this also serves the public page) but capped at a short burst.
    const rate = await checkRateLimits(
      bucketKey,
      session ? "cert-verify:user" : "cert-verify:ip",
      [
        [10, 10],
        [60, 60],
      ],
    );
    if (!rate.allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.`,
      });
    }
  }

  const normalized = tryNormalizeCertificateCode(getRouterParam(event, "code") ?? "");
  if (!normalized.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid certificate code format.",
    });
  }

  const found = await getCertificateByCode(normalized.code);
  if (!found) {
    throw createError({
      statusCode: 404,
      statusMessage: "No certificate matches that code.",
    });
  }

  return toPublicCertificate(found.cert, found.username);
});
