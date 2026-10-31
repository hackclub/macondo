// Embeds the same satori PNG as the image endpoint so the two never drift.


import {
  getCertificateByCode,
  toPublicCertificate,
  tryNormalizeCertificateCode,
} from "~~/server/lib/certificates";
import { renderCertificatePdf } from "~~/server/lib/certificate-pdf";
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
      session ? "cert-pdf:user" : "cert-pdf:ip",
      [
        [4, 10], // [max requests, window seconds]
        [12, 60],
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

  const pub = toPublicCertificate(found.cert, found.username);
  const bytes = await renderCertificatePdf(pub);

  setHeader(event, "content-type", "application/pdf");
  setHeader(
    event,
    "content-disposition",
    // ?inline serves it inline for the page's <iframe>; otherwise as an attachment.
    getQuery(event).inline !== undefined
      ? "inline"
      : `attachment; filename="macondo-certificate-${pub.code}.pdf"`,
  );
  return Buffer.from(bytes);
});
