import { useRuntimeConfig } from "#imports";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// postgres.js default max=10 causes head-of-line blocking under concurrent load.
// idle_timeout reclaims connections left idle across deploys.
export const sql = postgres(useRuntimeConfig().databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  idle_timeout: 30, // seconds
  connect_timeout: 10,
  prepare: false,
  onnotice: () => {},
});

export const db = drizzle(sql);
export default db;
