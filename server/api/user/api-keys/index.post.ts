import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import db from "~~/server/db";
import { apiKeyTable } from "~~/server/db/schema";
import { generateApiKey, MAX_ACTIVE_API_KEYS } from "~~/server/lib/api-keys";
import { writeAudit } from "~~/server/lib/audit";
import { checkRateLimit } from "~~/server/lib/rate-limit";
import { getSession } from "~~/server/lib/session";

// The raw key is returned once and never stored; only its hash is. Session-only (see index.get.ts).
const ALLOWED_EXPIRY_DAYS = new Set([30, 90, 365]);

export default defineEventHandler(async (event) => {
  if (process.env.MACONDO_API_KEYS_DISABLED === "1") {
    throw createError({ statusCode: 404, statusMessage: "API keys are disabled" });
  }
  if (event.context.apiKeyAuth) {
    throw createError({
      statusCode: 401,
      statusMessage: "API keys cannot manage API keys",
    });
  }
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  // Throttle so a stuck client can't fill the table.
  if (!(await checkRateLimit(user.id, "api_key_mint", 10, 3600)).allowed) { // 10 mints per hour
    throw createError({
      statusCode: 429,
      statusMessage: "Too many keys created recently. Try again later.",
    });
  }

  const body = await readBody<{ label?: string; days?: number | null }>(event);

  const label = (body?.label ?? "").trim().slice(0, 64) || // max label length
    `API key (${new Date().toISOString().slice(0, 10)})`;

  const days = body?.days == null ? null : Number(body.days);
  if (days !== null && !ALLOWED_EXPIRY_DAYS.has(days)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Expiry must be one of 30, 90, or 365 days.",
    });
  }

  const { raw, hash, last4 } = generateApiKey();
  const expiresAt = days !== null ? new Date(Date.now() + days * 86_400_000) : null; // ms per day

  // Per-user lock so concurrent mints can't both pass the cap. Expired keys don't count.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`api_key_mint:${user.id}`}))`,
    );

    const [{ count: activeCount }] = (await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(apiKeyTable)
      .where(
        and(
          eq(apiKeyTable.user_id, user.id),
          isNull(apiKeyTable.revoked_at),
          or(
            isNull(apiKeyTable.expires_at),
            gt(apiKeyTable.expires_at, new Date()),
          ),
        ),
      )) as [{ count: number }];

    if (activeCount >= MAX_ACTIVE_API_KEYS) {
      throw createError({
        statusCode: 400,
        statusMessage: `You already have ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.`,
      });
    }

    const [row] = await tx
      .insert(apiKeyTable)
      .values({
        token_hash: hash,
        user_id: user.id,
        label,
        last4,
        expires_at: expiresAt,
      })
      .returning({ id: apiKeyTable.id });
    return row ?? null;
  });

  try {
    await writeAudit({
      actor_id: user.id,
      action: "api_key.mint",
      entity_type: "api_key",
      entity_id: String(inserted?.id ?? ""),
      old_value: null,
      new_value: { label, last4, expires_at: expiresAt },
      sensitive: true,
      public_message: `Created API key "${label}"`,
    });
  } catch (err) {
    console.error("[api-keys] audit mint failed", err);
  }

  // `token` is surfaced once for copying; it is never retrievable again.
  return {
    id: inserted?.id ?? null,
    token: raw,
    label,
    last4,
    expires_at: expiresAt,
  };
});
