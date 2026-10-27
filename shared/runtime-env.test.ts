import { expect, test } from "bun:test";
import { applyRuntimeEnvAliases } from "./runtime-env";

test("runtime-only secrets retain existing Doppler aliases without overriding canonical values", () => {
  const env = {
    DATABASE_URL: "local-database-placeholder", HACKCLUB_AUTH_ID: "local-client",
    HACKCLUB_AUTH_SECRET: "local-secret", NUXT_HCB_SECRET: "oauth-placeholder",
    NUXT_REDIS_URL: "canonical-placeholder", REDIS_URL: "legacy-placeholder",
  } as NodeJS.ProcessEnv;
  applyRuntimeEnvAliases(env);
  expect(env.NUXT_DATABASE_URL).toBe("local-database-placeholder");
  expect(env.NUXT_HACKCLUB_AUTH_CLIENT_ID).toBe("local-client");
  expect(env.NUXT_HACKCLUB_AUTH_CLIENT_SECRET).toBe("local-secret");
  expect(env.NUXT_HCB_OAUTH_SECRET).toBe("oauth-placeholder");
  expect(env.NUXT_HCB_API_TOKEN).toBeUndefined();
  expect(env.NUXT_REDIS_URL).toBe("canonical-placeholder");
});
