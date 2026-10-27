import db from "../db";
import { piiLockerTable } from "../db/schema";
import type { HackClubAuthAddress } from "./shipping-address";

// Helpers live in ./shipping-address so they import without the Nuxt runtime/db;
// re-exported so existing importers of ./locker keep working.
export {
  type HackClubAuthAddress,
  isCompleteShippingAddress,
  isPlausibleRealName,
  isShippableAddress,
  isShippableField,
  pickPrimaryAddress,
  preferFullerAddressName,
} from "./shipping-address";

type HackClubIdentity = {
  first_name?: string;
  last_name?: string;
  phone_number?: string | null;
  birthday?: string | null;
  addresses?: HackClubAuthAddress[];
};

// ISO YYYY-MM-DD so the airtable Date column and pii_locker varchar(10) match.
function normalizeBirthday(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) return isoMatch[1]!;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function upsertPiiLocker(
  userId: string,
  identity: HackClubIdentity,
) {
  const now = new Date();
  const normalizedBirthday = normalizeBirthday(identity.birthday ?? null);

  await db
    .insert(piiLockerTable)
    .values({
      user_id: userId,
      first_name: identity.first_name?.trim() || null,
      last_name: identity.last_name?.trim() || null,
      phone_number: identity.phone_number ?? null,
      birthday: normalizedBirthday,
      addresses: identity.addresses ?? [],
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: piiLockerTable.user_id,
      set: {
        first_name: identity.first_name?.trim() || null,
        last_name: identity.last_name?.trim() || null,
        phone_number: identity.phone_number ?? null,
        birthday: normalizedBirthday,
        addresses: identity.addresses ?? [],
        updated_at: now,
      },
    });
}
