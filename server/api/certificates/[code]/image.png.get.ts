// A revoked certificate still renders, stamped REVOKED, so a shared link stays honest.

import {
  getCertificateByCode,
  toPublicCertificate,
  tryNormalizeCertificateCode,
} from "~~/server/lib/certificates";
import { renderCertificatePng } from "~~/server/lib/certificate-image";
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
    const rate = await checkRateLimits(
      bucketKey,
      session ? "cert-image:user" : "cert-image:ip",
      [
        [6, 10], // [max requests, window seconds]
        [20, 60],
      ],
    );
    if (!rate.allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.`,
      });
    }
  }

  const normalized = tryNormalizeCertificateCode(
    getRouterParam(event, "code") ?? "",
  );
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

  const png = await renderCertificatePng(
    toPublicCertificate(found.cert, found.username),
  );

  setHeader(event, "content-type", "image/png");
  setHeader(event, "cache-control", "public, max-age=300");
  return png;
});
