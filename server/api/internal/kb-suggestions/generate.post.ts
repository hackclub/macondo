import { writeAudit } from "../../../lib/audit";
import { runKbCuration } from "../../../lib/support-kb-curation";
import { canManageSupporterKB } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const rawWindow = ((await readBody(event).catch(() => ({}) as Record<string, unknown>)) as Record<string, unknown>)?.windowDays;
  let windowDays: number | undefined;
  if (typeof rawWindow === "number" && Number.isFinite(rawWindow)) {
    windowDays = Math.min(Math.max(Math.trunc(rawWindow), 1), 90);
  }

  const result = await runKbCuration({ windowDays });

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestions.generated",
    entity_type: "kb_suggestion",
    entity_id: "generate",
    new_value: result,
  });

  return { ok: true, ...result };
});
