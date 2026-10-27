import type { H3Event } from "h3";

import type { ShopRegion } from "./regions";
import { countryToRegion, isShopRegion } from "./regions";

type RegionResolvable = {
  country?: string | null;
  region_override?: string | null;
};

// The picker override wins so users can preview any region's prices; orders are
// still priced by shipping country (resolveOrderRegion), so there's no dodge.
export function resolveBrowsingRegion(
  event: H3Event,
  user: RegionResolvable | null | undefined,
): ShopRegion {
  if (user?.region_override && isShopRegion(user.region_override)) {
    return user.region_override;
  }

  if (user?.country) {
    return countryToRegion(user.country);
  }

  const headerCountry = getRequestHeader(event, "cf-ipcountry");
  if (headerCountry) {
    return countryToRegion(headerCountry);
  }

  return "NA";
}

// Non-shipping items return null so regional pricing is skipped entirely.
export function resolveOrderRegion(
  itemKind: "physical" | "grant" | "consumable" | "experience" | "virtual_service",
  shippingCountry: string | null | undefined,
  fallback: ShopRegion,
): ShopRegion | null {
  if (itemKind !== "physical") return null;
  if (shippingCountry) return countryToRegion(shippingCountry);
  return fallback;
}

// Availability only, not pricing: grants are also blocked by billing country because some
// card grants can't be redeemed there (e.g. Minecraft in India).
export function resolveAvailabilityRegion(
  itemKind: "physical" | "grant" | "consumable" | "experience" | "virtual_service",
  addressCountry: string | null | undefined,
  fallback: ShopRegion,
): ShopRegion | null {
  if (itemKind !== "physical" && itemKind !== "grant") return null;
  if (addressCountry) return countryToRegion(addressCountry);
  return fallback;
}
