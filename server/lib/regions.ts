// India and Brazil get their own buckets because their shipping and import
// costs diverge sharply from the rest of their continents.

export const SHOP_REGIONS = ["NA", "SA", "BR", "EU", "AS", "IN", "OC", "AF", "ME"] as const;
export type ShopRegion = (typeof SHOP_REGIONS)[number];

export const REGION_LABEL: Record<ShopRegion, string> = {
  NA: "North America",
  SA: "South America",
  BR: "Brazil",
  EU: "Europe",
  AS: "Asia",
  IN: "India",
  OC: "Oceania",
  AF: "Africa",
  ME: "Middle East",
};

export const COUNTRY_TO_REGION: Record<string, ShopRegion> = {
  US: "NA", CA: "NA", MX: "NA", GT: "NA", BZ: "NA", SV: "NA", HN: "NA",
  NI: "NA", CR: "NA", PA: "NA", CU: "NA", JM: "NA", HT: "NA", DO: "NA",
  PR: "NA", BS: "NA", BB: "NA", TT: "NA", AG: "NA", DM: "NA", GD: "NA",
  KN: "NA", LC: "NA", VC: "NA", AI: "NA", AW: "NA", BM: "NA", BQ: "NA",
  KY: "NA", CW: "NA", GL: "NA", GP: "NA", MQ: "NA", MS: "NA", SX: "NA",
  TC: "NA", VG: "NA", VI: "NA", PM: "NA",

  AR: "SA", BO: "SA", CL: "SA", CO: "SA", EC: "SA", GY: "SA",
  PY: "SA", PE: "SA", SR: "SA", UY: "SA", VE: "SA", FK: "SA", GF: "SA",

  BR: "BR",

  AD: "EU", AL: "EU", AT: "EU", AX: "EU", BA: "EU", BE: "EU", BG: "EU",
  BY: "EU", CH: "EU", CY: "EU", CZ: "EU", DE: "EU", DK: "EU", EE: "EU",
  ES: "EU", FI: "EU", FO: "EU", FR: "EU", GB: "EU", GG: "EU", GI: "EU",
  GR: "EU", HR: "EU", HU: "EU", IE: "EU", IM: "EU", IS: "EU", IT: "EU",
  JE: "EU", LI: "EU", LT: "EU", LU: "EU", LV: "EU", MC: "EU", MD: "EU",
  ME: "EU", MK: "EU", MT: "EU", NL: "EU", NO: "EU", PL: "EU", PT: "EU",
  RO: "EU", RS: "EU", RU: "EU", SE: "EU", SI: "EU", SJ: "EU", SK: "EU",
  SM: "EU", UA: "EU", VA: "EU", XK: "EU",

  AF: "AS", BD: "AS", BN: "AS", BT: "AS", CN: "AS", HK: "AS", ID: "AS",
  JP: "AS", KG: "AS", KH: "AS", KR: "AS", KP: "AS", KZ: "AS",
  LA: "AS", LK: "AS", MM: "AS", MN: "AS", MO: "AS", MY: "AS", MV: "AS",
  NP: "AS", PH: "AS", PK: "AS", SG: "AS", TH: "AS", TJ: "AS", TL: "AS",
  TM: "AS", TW: "AS", UZ: "AS", VN: "AS",

  IN: "IN",

  AU: "OC", NZ: "OC", FJ: "OC", PG: "OC", SB: "OC", VU: "OC", WS: "OC",
  TO: "OC", KI: "OC", TV: "OC", NR: "OC", MH: "OC", FM: "OC", PW: "OC",
  CK: "OC", NU: "OC", AS: "OC", WF: "OC", NC: "OC", PF: "OC", GU: "OC",
  MP: "OC", TK: "OC",

  DZ: "AF", AO: "AF", BJ: "AF", BW: "AF", BF: "AF", BI: "AF", CM: "AF",
  CV: "AF", CF: "AF", TD: "AF", KM: "AF", CG: "AF", CD: "AF", CI: "AF",
  DJ: "AF", GQ: "AF", ER: "AF", SZ: "AF", ET: "AF", GA: "AF",
  GM: "AF", GH: "AF", GN: "AF", GW: "AF", KE: "AF", LS: "AF", LR: "AF",
  LY: "AF", MG: "AF", MW: "AF", ML: "AF", MR: "AF", MU: "AF", MA: "AF",
  MZ: "AF", NA: "AF", NE: "AF", NG: "AF", RW: "AF", ST: "AF", SN: "AF",
  SC: "AF", SL: "AF", SO: "AF", ZA: "AF", SS: "AF", SD: "AF", TZ: "AF",
  TG: "AF", TN: "AF", UG: "AF", EH: "AF", ZM: "AF", ZW: "AF", RE: "AF",
  YT: "AF", SH: "AF",

  // Middle East. Egypt sits here rather than Africa by shop region policy.
  EG: "ME", SA: "ME", AE: "ME", IL: "ME", JO: "ME", LB: "ME", IQ: "ME",
  IR: "ME", KW: "ME", OM: "ME", QA: "ME", BH: "ME", YE: "ME", SY: "ME",
  PS: "ME", TR: "ME",
};

export function countryToRegion(
  countryCode: string | null | undefined,
): ShopRegion {
  if (!countryCode) return "NA";
  const upper = countryCode.trim().toUpperCase();
  if (upper.length === 0) return "NA";
  return COUNTRY_TO_REGION[upper] ?? "NA";
}

export function isShopRegion(value: unknown): value is ShopRegion {
  return typeof value === "string" && (SHOP_REGIONS as readonly string[]).includes(value);
}
