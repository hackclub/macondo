import { hasRole } from "../../../policies/internal";
import { isMusicEnabled, setMusicEnabled } from "../../../lib/app-settings";
import { writeAudit } from "../../../lib/audit";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = (await readBody<{ enabled?: boolean }>(event)) ?? {};
  if (typeof body.enabled !== "boolean") {
    throw createError({
      statusCode: 400,
      statusMessage: "enabled must be a boolean",
    });
  }

  const previous = await isMusicEnabled();
  if (previous === body.enabled) {
    return { enabled: body.enabled };
  }

  await setMusicEnabled(body.enabled, actor.id);

  await writeAudit({
    actor_id: actor.id,
    action: body.enabled ? "music_enable" : "music_disable",
    entity_type: "app_setting",
    entity_id: "music_enabled",
    old_value: { enabled: previous },
    new_value: { enabled: body.enabled },
    change_summary: body.enabled
      ? "Background music player ENABLED site-wide."
      : "Background music player DISABLED site-wide.",
  });

  return { enabled: body.enabled };
});
