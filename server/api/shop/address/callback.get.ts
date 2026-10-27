import { eq } from "drizzle-orm";

import db from "../../../db";
import { users } from "../../../db/schema";
import { exchangeCode, getUserInfo, safeReturnTo } from "../../../lib/auth";
import {
  type ShopCheckoutAddressOption,
  normalizeShippingAddress,
  setShopCheckoutAddress,
} from "../../../lib/shop";
import { getSession } from "../../../lib/session";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code as string | undefined;

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing OAuth code",
    });
  }

  const state = query.state as string | undefined;
  const storedState = getCookie(event, "shop_address_oauth_state");
  deleteCookie(event, "shop_address_oauth_state", { path: "/" });

  if (!state || !storedState || state !== storedState) {
    throw createError({
      statusCode: 403,
      statusMessage: "Invalid OAuth state",
    });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const config = useRuntimeConfig();
  const redirectUri = `${getRequestURL(event).origin}/api/shop/address/callback`;
  const clientId = config.hackclubAuthClientId as string | undefined;
  const clientSecret = config.hackclubAuthClientSecret as string | undefined;

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: "Hack Club Auth is not configured.",
    });
  }

  const { identity } = await getUserInfo(
    (await exchangeCode(clientId, clientSecret, redirectUri, code)).access_token,
  );

  if (
    !(
      (user.sub != null && user.sub === identity.id) ||
      user.email.toLowerCase() === identity.primary_email.toLowerCase()
    )
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "Hack Club Auth returned a different account",
    });
  }

  const addresses = (identity.addresses ?? [])
    .map((entry, index) => {
      const shippingAddress = normalizeShippingAddress({
        firstName: entry.first_name ?? identity.first_name,
        lastName: entry.last_name ?? identity.last_name,
        address1: entry.line_1,
        address2: entry.line_2,
        city: entry.city,
        state: entry.state,
        postalCode: entry.postal_code,
        country: entry.country,
      });

      if (!shippingAddress) return null;

      const phone =
        typeof entry.phone_number === "string" &&
        entry.phone_number.trim().length > 0
          ? entry.phone_number.trim()
          : typeof identity.phone_number === "string" &&
              identity.phone_number.trim().length > 0
            ? identity.phone_number.trim()
            : null;

      return {
        id: entry.id || `address-${index}`,
        label: [
          `${shippingAddress.firstName} ${shippingAddress.lastName}`.trim(),
          shippingAddress.address1,
          shippingAddress.address2,
          shippingAddress.city,
          shippingAddress.state,
          shippingAddress.postalCode,
          shippingAddress.country,
        ].filter(Boolean).join(" - "),
        primary: entry.primary === true,
        shippingAddress,
        phone,
      };
    })
    .filter((entry): entry is ShopCheckoutAddressOption => !!entry);

  const primaryAddress =
    addresses.find((entry) => entry.primary) ??
    addresses[0];

  if (!primaryAddress) {
    throw createError({
      statusCode: 400,
      statusMessage: "Hack Club Auth did not return a complete shipping address",
    });
  }

  setShopCheckoutAddress(event, {
    addresses,
    shippingAddress: primaryAddress.shippingAddress,
    phone: primaryAddress.phone,
  });

  // Persisted so later shop requests price by region without re-reading HCA.
  const primaryCountry = primaryAddress.shippingAddress.country?.trim().toUpperCase();
  if (primaryCountry && primaryCountry.length === 2) {
    try {
      await db
        .update(users)
        .set({ country: primaryCountry })
        .where(eq(users.id, user.id));
    } catch (error) {
      console.error("Failed to persist user.country from shipping address", error);
    }
  }

  // Re-sanitized on use as well: the cookie is only as trustworthy as every
  // writer, and safeReturnTo keeps the redirect same-origin no matter what.
  const returnTo = safeReturnTo(getCookie(event, "shop_address_return_to"), "/shop");
  deleteCookie(event, "shop_address_return_to", { path: "/" });
  return sendRedirect(event, returnTo);
});
