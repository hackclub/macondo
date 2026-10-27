import db from "../../../../db";
import { mcpTokenTable } from "../../../../db/schema";
import { generateMcpToken } from "../../../../lib/mcp/auth";
import { writeAudit } from "../../../../lib/audit";
import { canManageMcpTokens } from "../../../../policies/internal";

// The raw token is returned once and never stored; only its SHA256 hash is.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canManageMcpTokens(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{
    label?: string;
    days?: number | null;
    canWrite?: boolean;
  }>(event);

  const label =
    (body.label ?? "").trim() ||
    `${actor.name} (${new Date().toISOString().slice(0, 10)})`;

  const days = body.days == null ? null : Number(body.days);
  if (days !== null && (!Number.isFinite(days) || days <= 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Expiry must be a positive number of days.",
    });
  }
  const canWrite = body.canWrite === true;

  const { raw, hash, last4 } = generateMcpToken();
  const expiresAt = days !== null ? new Date(Date.now() + days * 86_400_000) : null; // ms per day

  const [inserted] = await db
    .insert(mcpTokenTable)
    .values({
      token_hash: hash,
      user_id: actor.id,
      label,
      last4,
      can_write: canWrite,
      expires_at: expiresAt,
    })
    .returning({ id: mcpTokenTable.id });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "mcp_token.mint",
      entity_type: "mcp_token",
      entity_id: String(inserted?.id ?? ""),
      old_value: null,
      new_value: { label, can_write: canWrite, last4, expires_at: expiresAt },
      sensitive: true,
      public_message: `Minted MCP token "${label}"`,
      change_summary: canWrite ? "read-write" : "read-only",
    });
  } catch (err) {
    console.error("[mcp] audit token mint failed", err);
  }

  return { ok: true, id: inserted?.id ?? null, token: raw, label, can_write: canWrite };
});
