import { writeAudit } from "../../../lib/audit";
import { deleteHcbOAuthConnection } from "../../../lib/hcb";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  await deleteHcbOAuthConnection();

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "disconnect_hcb_grants_oauth",
      entity_type: "internal_oauth_connection",
      entity_id: "hcb_grants",
      sensitive: true,
      public_message: "HCB grants OAuth disconnected",
      change_summary: "Removed stored HCB grants OAuth connection",
    });
  } catch (error) {
    console.error("Failed to write HCB OAuth disconnect audit log", error);
  }

  return { ok: true };
});
