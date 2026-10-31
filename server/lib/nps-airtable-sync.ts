import { asc, eq, isNull } from "drizzle-orm";
import db from "../db";
import { npsResponseTable, users } from "../db/schema";
import { AIRTABLE_API_URL } from "./api-urls";

const UNIFIED_BASE_ID = "app3A5kJwYqxMLOgh";
const NPS_TABLE_ID = "tblQpkS0I9V2ixBD0";
const MACONDO_YSWS_RECORD_ID = "recEiXtNumlz40W3N";
const BATCH_SIZE = 10;
const MAX_PER_TICK = 200;

type AirtableCreateResponse = {
  records: { id: string; fields: Record<string, unknown> }[];
};

function unifiedToken(): string | null {
  const config = useRuntimeConfig();
  return (
    (config as unknown as { airtableUnifiedToken?: string })
      .airtableUnifiedToken || null
  );
}

function toAirtableFields(row: {
  score: number;
  doing_well: string;
  can_improve: string;
  anything_else: string | null;
  created_at: Date;
  email: string | null;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    "On a scale from 1-10, how likely are you to recommend this YSWS to a friend?":
      row.score,
    YSWS: [{ id: MACONDO_YSWS_RECORD_ID }],
    "What are we doing well?": row.doing_well,
    "How can we improve?": row.can_improve,
    "Override Created At": row.created_at.toISOString(),
    "Tags (Comma Separated)": "macondo",
  };

  if (row.email) {
    fields["Email (optional, for prize)"] = row.email;
  }
  if (row.anything_else) {
    fields["Custom Fields"] = row.anything_else;
  }

  return fields;
}

export async function syncNpsToAirtable(): Promise<{
  synced: number;
  errors: number;
  remaining: number;
}> {
  const token = unifiedToken();
  if (!token) {
    return { synced: 0, errors: 0, remaining: 0 };
  }

  const unsynced = await db
    .select({
      id: npsResponseTable.id,
      score: npsResponseTable.score,
      doing_well: npsResponseTable.doing_well,
      can_improve: npsResponseTable.can_improve,
      anything_else: npsResponseTable.anything_else,
      created_at: npsResponseTable.created_at,
      email: users.email,
    })
    .from(npsResponseTable)
    .innerJoin(users, eq(npsResponseTable.user_id, users.id))
    .where(isNull(npsResponseTable.airtable_record_id))
    .orderBy(asc(npsResponseTable.id))
    .limit(MAX_PER_TICK);

  if (unsynced.length === 0) {
    return { synced: 0, errors: 0, remaining: 0 };
  }

  let synced = 0;
  let errors = 0;

  for (let i = 0; i < unsynced.length; i += BATCH_SIZE) {
    const batch = unsynced.slice(i, i + BATCH_SIZE);
    const records = batch.map((row) => ({ fields: toAirtableFields(row) }));

    try {
      const url = `${AIRTABLE_API_URL}/${UNIFIED_BASE_ID}/${NPS_TABLE_ID}`;
      const data = await $fetch<AirtableCreateResponse>(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: { records, typecast: true },
      });

      for (let j = 0; j < data.records.length; j++) {
        const airtableId = data.records[j]!.id;
        const localId = batch[j]!.id;
        await db
          .update(npsResponseTable)
          .set({ airtable_record_id: airtableId })
          .where(eq(npsResponseTable.id, localId));
      }

      synced += data.records.length;
    } catch (err) {
      console.error(
        `[nps-airtable-sync] batch failed (ids ${batch[0]!.id}–${batch.at(-1)!.id}):`,
        err,
      );
      errors += batch.length;
    }
  }

  const countRemaining = await db
    .select({ id: npsResponseTable.id })
    .from(npsResponseTable)
    .where(isNull(npsResponseTable.airtable_record_id))
    .limit(1);

  return { synced, errors, remaining: countRemaining.length };
}
