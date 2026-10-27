import { defineConfig } from "drizzle-kit";

// Either key name works so the migrator runs in local dev and Doppler prod;
// throwing beats drizzle-kit's vague ECONNREFUSED when neither is set.
const url = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "drizzle.config: neither NUXT_DATABASE_URL nor DATABASE_URL is set. " +
      "Make sure Doppler (or .env) exposes one of them before running drizzle-kit.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  dbCredentials: { url },
});
