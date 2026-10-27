import { and, eq, isNotNull, isNull } from "drizzle-orm";
import db from "../db";
import { appSettingsTable, certificatesTable, eventAttendeeTable } from "../db/schema";
import { SHIP_DEADLINE_MS, SHIP_EXTENSION_DEADLINE_MS } from "./macondo-end";

// Re-exported so existing ship-deadline imports keep working.
export {
  SHIP_DEADLINE_MS,
  SHIP_EXTENSION_DEADLINE_MS,
} from "./macondo-end";

export async function hasShipExtension(user: {
  id: string;
  slack_id: string | null;
}): Promise<boolean> {
  if (user.slack_id) {
    // Slack IDs from the extension form live in app_settings because they're PII and must never be committed.
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "ship_extension_slack_ids"))
      .limit(1);
    if (Array.isArray(row?.value) && row.value.includes(user.slack_id)) {
      return true;
    }
  }
  // IRL attendees also get it: an active certificate, or staff-confirmed attendance if unclaimed.
  const [cert] = await db
    .select({ id: certificatesTable.id })
    .from(certificatesTable)
    .where(
      and(
        eq(certificatesTable.user_id, user.id),
        isNull(certificatesTable.revoked_at),
      ),
    )
    .limit(1);
  if (cert) return true;
  const [attended] = await db
    .select({ id: eventAttendeeTable.id })
    .from(eventAttendeeTable)
    .where(
      and(
        eq(eventAttendeeTable.user_id, user.id),
        isNotNull(eventAttendeeTable.attended_at),
      ),
    )
    .limit(1);
  return !!attended;
}

// Also surfaced on /api/auth/me for the countdown widget.
export async function getShipDeadlineMs(user: {
  id: string;
  slack_id: string | null;
}): Promise<number> {
  return (await hasShipExtension(user))
    ? SHIP_EXTENSION_DEADLINE_MS
    : SHIP_DEADLINE_MS;
}
