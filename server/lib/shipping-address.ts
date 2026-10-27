// Kept dependency-free so smoke tests can import it without booting Nuxt or the db.

export type HackClubAuthAddress = {
  id?: string;
  first_name?: string;
  last_name?: string;
  line_1?: string;
  line_2?: string | null;
  city?: string;
  state?: string | null;
  postal_code?: string;
  country?: string;
  phone_number?: string | null;
  primary?: boolean;
};

// Shared so the airtable sync and repair pass agree on which address gets pushed.
export function pickPrimaryAddress(raw: unknown): HackClubAuthAddress | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const list = raw as HackClubAuthAddress[];
  return list.find((a) => a?.primary) ?? list[0] ?? null;
}

// Catches "." / "a" / "-" garbage without rejecting "NY"; Unicode-aware so non-Latin addresses pass.
export function isShippableField(
  value: unknown,
  minAlphanumeric = 2,
): boolean {
  if (typeof value !== "string") return false;
  return (value.trim().match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= minAlphanumeric;
}

// Lenient: one real non-country field is enough. Country is excluded because some
// HCA records are "." everywhere except country.
type ShippableAddressInput = {
  line_1?: unknown;
  line_2?: unknown;
  city?: unknown;
  state?: unknown;
  postal_code?: unknown;
  // Accepted so HackClubAuthAddress fits, but country alone never makes an address shippable.
  country?: unknown;
};
export function isShippableAddress(
  addr: ShippableAddressInput | null | undefined,
): boolean {
  if (!addr) return false;
  return (
    isShippableField(addr.line_1) ||
    isShippableField(addr.line_2) ||
    isShippableField(addr.city) ||
    isShippableField(addr.state) ||
    isShippableField(addr.postal_code)
  );
}

// Hard pre-submit gate. Postal code and state aren't required because many countries
// have neither; fake-looking addresses are left to the AI warn.
export function isCompleteShippingAddress(
  addr: ShippableAddressInput | null | undefined,
): boolean {
  if (!addr) return false;
  const hasStreet = isShippableField(addr.line_1, 3); // min chars for a street line
  const hasCity = isShippableField(addr.city, 2);
  return hasStreet && hasCity;
}

// Deliberately small since this is a hard block; fuzzier fakes go to the AI warn.
// "na"/"nan" are excluded because they're real given names in some cultures.
const JUNK_NAME_TOKENS = new Set([
  "test", "testtest", "asdf", "asdfasdf", "asdfghjkl", "qwerty", "aaa", "abc",
  "abcabc", "xxx", "none", "null", "undefined", "fake", "fakename",
  "johndoe", "janedoe", "firstname", "lastname", "fname", "lname", "name",
  "unknown", "nobody", "anon", "anonymous", "user", "idk",
]);

// Conservative hard gate. Resolve first/last the same way the Airtable sync does
// before calling, so it flags exactly what reviewers see.
export function isPlausibleRealName(
  first: string | null | undefined,
  last: string | null | undefined,
): boolean {
  const combined = `${(first ?? "").trim()} ${(last ?? "").trim()}`.trim();
  if ((combined.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return false;
  const collapsed = combined.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (JUNK_NAME_TOKENS.has(collapsed)) return false;
  if (collapsed.length >= 2 && /^(.)\1+$/u.test(collapsed)) return false;
  return true;
}

function nameTokens(
  first: string | null | undefined,
  last: string | null | undefined,
): string[] {
  return `${(first ?? "").trim()} ${(last ?? "").trim()}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Address name only when it strictly expands the signup name: many mismatches are a guardian or
// mail drop, whose name can never be a superset of the maker's.
// Known gap: trailing junk ("Abraham House") passes; a token cap would also reject long South Asian names.
export function preferFullerAddressName(
  lockerFirst: string | null | undefined,
  lockerLast: string | null | undefined,
  address: HackClubAuthAddress | null | undefined,
): { first: string; last: string } | null {
  if (!address) return null;
  const first = address.first_name?.trim();
  const last = address.last_name?.trim();
  if (!isPlausibleRealName(first, last)) return null;

  const base = nameTokens(lockerFirst, lockerLast);
  const candidate = nameTokens(first, last);
  if (!base.length || !candidate.length) return null;

  // "Divyansh Divyansh" is longer but not a fuller name.
  if (new Set(candidate).size === 1 && candidate.length > 1) return null;

  const pool = [...candidate];
  for (const token of base) {
    let i = pool.indexOf(token);
    if (i === -1 && token.length === 1) {
      i = pool.findIndex((p) => p.startsWith(token));
    }
    if (i === -1) return null;
    pool.splice(i, 1);
  }

  // Must actually add name characters, which blocks no-ops.
  if (candidate.join("").length <= base.join("").length) return null;

  return { first: first ?? "", last: last ?? "" };
}
