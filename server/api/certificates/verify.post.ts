// Tightly rate-limited (5/hour) so the typed verify can't be used to fish for codes;
// the certificate page renders the authoritative result.

import { tryNormalizeCertificateCode } from "~~/server/lib/certificates";
import { checkRateLimit } from "~~/server/lib/rate-limit";
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

type VerifyBody = { code?: string };

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const bucketKey = session ? session.id : getIpAddress(event);
  if (bucketKey) {
    const rate = await checkRateLimit(
      bucketKey,
      session ? "cert-typed-verify:user" : "cert-typed-verify:ip",
      5, // max attempts per window
      3600, // one hour window
    );
    if (!rate.allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Too many verification attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
      });
    }
  }

  const body = await readBody<VerifyBody>(event).catch(() => ({}) as VerifyBody);
  const normalized = tryNormalizeCertificateCode(body?.code ?? "");
  if (!normalized.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid certificate code format.",
    });
  }

  return { code: normalized.code };
});
