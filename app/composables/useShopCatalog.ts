// The catalog path and payload key rotate every 15 minutes; see server/routes/_ui/c/[k].get.ts.
// Call fetch() from useAsyncData with `server: false`, or SSR serializes the catalog into the HTML.
import {
  decodeCatalogPayload,
  isObfuscatedEnvelope,
} from "~~/shared/utils/shop-obfuscation";
import type { ShopKeys } from "~~/shared/utils/shop-keys";
import { SHOP_KEYS_STATE } from "~~/shared/utils/shop-keys";

export type ShopCatalogQuery = Record<string, string | number | undefined>;

export function useShopCatalog(): {
  fetch: <T>(query?: ShopCatalogQuery) => Promise<T>;
} {
  const keys = useState<ShopKeys | null>(SHOP_KEYS_STATE, () => null);

  // Needs a valid mq_ui cookie and first-party headers, same as the catalog.
  async function rekey(): Promise<ShopKeys> {
    const fresh = await $fetch<ShopKeys>("/_ui/k");
    keys.value = fresh;
    return fresh;
  }

  async function attempt<T>(k: ShopKeys, query?: ShopCatalogQuery): Promise<T> {
    const raw = await $fetch<unknown>(`/_ui/c/${k.p}`, { query });
    if (!isObfuscatedEnvelope(raw)) return raw as T;
    return decodeCatalogPayload(k.s, raw) as T;
  }

  return {
    async fetch<T>(query?: ShopCatalogQuery): Promise<T> {
      const current = keys.value ?? (await rekey());
      try {
        return await attempt<T>(current, query);
      } catch (error) {
        // 404 means the key rolled past the server's grace window while the tab sat open.
        const status = (error as { statusCode?: number; status?: number })
          ?.statusCode ?? (error as { status?: number })?.status;
        if (status !== 404) throw error;
        return await attempt<T>(await rekey(), query);
      }
    },
  };
}
