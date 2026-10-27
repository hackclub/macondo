import { getShopCheckoutAddress } from "../../lib/shop";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return getShopCheckoutAddress(event);
});
