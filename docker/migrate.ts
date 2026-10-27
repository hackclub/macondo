import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error("Migrations require NUXT_DATABASE_URL or DATABASE_URL");
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
try {
  // Same journal, schema, and migration table defaults as drizzle-kit migrate.
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
} finally {
  await sql.end({ timeout: 5 });
}
