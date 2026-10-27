// Ships the catalog keys via the SSR payload. Deliberately imports nothing from server/
// so the private uiGateSecret has no route into the client bundle.

import type { ShopKeys } from "~~/shared/utils/shop-keys";
import { SHOP_KEYS_STATE } from "~~/shared/utils/shop-keys";

export default defineNuxtPlugin(() => {
  const keys = useState<ShopKeys | null>(SHOP_KEYS_STATE, () => null);
  const event = useRequestEvent();
  keys.value = event?.context?.mqKeys ?? null;
});
