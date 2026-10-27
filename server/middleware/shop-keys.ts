// Keys are minted here (read by app/plugins/shop-keys.server.ts) so uiGateSecret
// never reaches the client bundle; only derived, expiring values cross over.

import { mintObfSecret, mintPathToken } from "../lib/ui-token";
import { obfBucket } from "../../shared/utils/shop-obfuscation";

export type ShopKeyContext = { p: string; s: string; b: number };

declare module "h3" {
  interface H3EventContext {
    mqKeys?: ShopKeyContext;
  }
}

const SKIP_PREFIXES = ["/_nuxt/", "/api/", "/_ui/", "/__nuxt", "/_ipx/"];

export default defineEventHandler((event) => {
  const path = event.path;
  if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

  const secret = ((useRuntimeConfig().uiGateSecret as string) ?? "").trim();
  if (!secret) {
    // Dev without the secret: the route serves plain JSON on any path.
    event.context.mqKeys = { p: "dev", s: "", b: 0 };
    return;
  }

  const bucket = obfBucket(Date.now());
  event.context.mqKeys = {
    p: mintPathToken(secret, bucket),
    s: mintObfSecret(secret, bucket),
    b: bucket,
  };
});
