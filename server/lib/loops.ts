// Field IDs are hardcoded on purpose: Airtable column renames don't change IDs.

import db from "../db";
import { loopsEventLogs } from "../db/schema";
import { AIRTABLE_API_URL } from "./api-urls";
import { escapeAirtableFormulaString } from "./airtable-formula";

const MACONDO_BASE_ID = "appYYPWFXz9IhZO03";
const MACONDO_USERS_TABLE_ID = "tblpbPBU70VDNoSOa";

const FIELD_EMAIL = "fldxFLNUHQiz2WVcY";
const FIELD_SLACK_ID = "fldx5nkxK3hoILBYl";
const FIELD_FIRST_NAME = "fldV7biNdftyzOMpk";
const FIELD_LAST_NAME = "fld9Ww2xJPlJHWGVa";

// An empty field ID still writes the local log row but skips the Airtable sync.
export const LOOPS_EVENT_FIELDS = {
  macondoRSVP: "fldMZGaUn3yAu8i1h",
  macondoAuthStarted: "fldByRkTJbcOOylvy",
  macondoAuthFinished: "fldYGyvXkufQ0YXXb",
  macondoTutorialCompleted: "fldc0M3E7kRup3lpP",
  macondoOnboardingCompleted: "",
  macondoFirstProjectCreated: "flda0P8U8RzZ9n5Is",
  macondoFirstProjectSubmitted: "fldDCIOyNCOtmy6X1",
  macondoFirstProjectShipped: "fldSVoSkyTLcoPZ2S",
  macondoOneHour: "fld7AnAQawqTF4Cl6",
  macondoFiveHours: "fldKTNlu5dNgLR1EN",
  macondoTenHours: "fldz3ZAUWARDIVyAg",
  macondoTwentyHours: "fldYmRIFhsNmpbPa7",
  // HCA verification milestones, stamped on every sign-in. Empty until the
  // Airtable columns exist; the local log keeps history to backfill from.
  macondoHcaPending: "",
  macondoHcaBasicInfoRequired: "",
  macondoHcaDocumentRequired: "",
  macondoHcaVerified: "",
} as const;

export type LoopsEvent = keyof typeof LOOPS_EVENT_FIELDS;

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableListResponse = {
  records: AirtableRecord[];
  offset?: string;
};

async function findUserRecordByEmail(
  token: string,
  email: string,
): Promise<string | null> {
  const formula = `LOWER({${FIELD_EMAIL}}) = LOWER('${escapeAirtableFormulaString(email)}')`;
  try {
    const res = await $fetch<AirtableListResponse>(
      `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        query: {
          filterByFormula: formula,
          maxRecords: 1,
        },
      },
    );
    return res.records[0]?.id ?? null;
  } catch {
    console.error("[loops] findUserRecordByEmail failed");
    return null;
  }
}

type SyncLoopsEventArgs = {
  email: string;
  slack_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  event: LoopsEvent;
  user_id?: string | null;
};

// Never throws; a missing AIRTABLE_TOKEN skips the sync so local dev works.
export async function syncLoopsEvent(args: SyncLoopsEventArgs): Promise<void> {
  const { email, event } = args;
  const now = new Date();

  // The local log is the authoritative history; Airtable only mirrors the latest.
  try {
    await db.insert(loopsEventLogs).values({
      user_id: args.user_id ?? null,
      user_email: email,
      event,
      occurred_at: now,
    });
  } catch {
    console.error("[loops] failed to write local log row");
  }

  const config = useRuntimeConfig();
  const token = config.airtableToken as string | undefined;
  if (!token) {
    console.warn("[loops] skipping Airtable sync, no AIRTABLE_TOKEN configured");
    return;
  }

  const fieldId = LOOPS_EVENT_FIELDS[event];
  if (fieldId === undefined) {
    console.error("[loops] unknown event", event);
    return;
  }
  if (fieldId === "") return;

  const fields: Record<string, unknown> = {
    [fieldId]: now.toISOString(),
  };
  if (args.slack_id != null) fields[FIELD_SLACK_ID] = args.slack_id;
  if (args.first_name != null) fields[FIELD_FIRST_NAME] = args.first_name;
  if (args.last_name != null) fields[FIELD_LAST_NAME] = args.last_name;

  try {
    const existingId = await findUserRecordByEmail(token, email);
    if (existingId) {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}/${existingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: { fields },
        },
      );
    } else {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: {
            records: [{ fields: { [FIELD_EMAIL]: email, ...fields } }],
          },
        },
      );
    }
  } catch {
    console.error("[loops] Airtable sync failed");
  }
}

// is_qualified date: present means qualified, empty means not.
const FIELD_IS_QUALIFIED = "fldh6W185uieOCOoY";

// singleSelect; its "Maybe" option is staff-only since the popup offers Yes/No.

// Fire-and-forget safe: never throws.
export async function setEventQualifiedFlag(args: {
  email: string;
  slack_id?: string | null;
  qualified: boolean;
}): Promise<void> {
  const config = useRuntimeConfig();
  const token = config.airtableToken as string | undefined;
  if (!token) {
    console.warn("[loops] skipping is_qualified sync, no AIRTABLE_TOKEN configured");
    return;
  }

  const fields: Record<string, unknown> = {
    [FIELD_IS_QUALIFIED]: args.qualified
      ? new Date().toISOString().slice(0, 10)
      : null,
  };
  if (args.slack_id != null) fields[FIELD_SLACK_ID] = args.slack_id;

  try {
    const existingId = await findUserRecordByEmail(token, args.email);
    if (existingId) {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}/${existingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: { fields },
        },
      );
    } else {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: {
            records: [{ fields: { [FIELD_EMAIL]: args.email, ...fields } }],
          },
        },
      );
    }
  } catch {
    console.error("[loops] is_qualified sync failed");
  }
}

const FIELD_PRE_ACCOMMODATION = "fldT7PJ1Aa2JErUJa";
const FIELD_POST_ACCOMMODATION = "fldOpYtm2a9PbSXfZ";

// Fire-and-forget safe: never throws.
export async function setAccommodationCount(args: {
  email: string;
  slack_id?: string | null;
  kind: "pre" | "post";
  count: number;
}): Promise<void> {
  const fieldId =
    args.kind === "pre" ? FIELD_PRE_ACCOMMODATION : FIELD_POST_ACCOMMODATION;

  const config = useRuntimeConfig();
  const token = config.airtableToken as string | undefined;
  if (!token) {
    console.warn(
      "[loops] skipping accommodation sync, no AIRTABLE_TOKEN configured",
    );
    return;
  }

  const fields: Record<string, unknown> = { [fieldId]: args.count };
  if (args.slack_id != null) fields[FIELD_SLACK_ID] = args.slack_id;

  try {
    const existingId = await findUserRecordByEmail(token, args.email);
    if (existingId) {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}/${existingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: { fields },
        },
      );
    } else {
      await $fetch(
        `${AIRTABLE_API_URL}/${MACONDO_BASE_ID}/${MACONDO_USERS_TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: {
            records: [{ fields: { [FIELD_EMAIL]: args.email, ...fields } }],
          },
        },
      );
    }
  } catch {
    console.error("[loops] accommodation sync failed");
  }
}
