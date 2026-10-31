import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

const directory = fileURLToPath(new URL("../drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(`${directory}/meta/_journal.json`, "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

test("deployment migrator discovers the NPS Airtable migration", () => {
  const sql = readFileSync(`${directory}/0176_nps_airtable_record_id.sql`, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  const loaded = readMigrationFiles({ migrationsFolder: directory });
  const migration = loaded.find(entry => entry.hash === hash);
  expect(migration).toBeDefined();
  expect(migration!.folderMillis).toBeGreaterThan(journal.entries.find(entry => entry.tag === "0175_drop_owo_uwu")!.when);
});

test("new SQL migrations cannot be silently omitted from the journal", () => {
  // These pre-existing files were already outside the journal before 0176.
  // Do not replay historical SQL against production by registering them now.
  const legacy = [
    "0003_breezy_fraudsquad_status", "0005_add_rejected_ship_status",
    "0018_add_user_timezone", "0019_ship_feedback_translations", "0023_github_id",
  ];
  const registered = new Set(journal.entries.map(entry => entry.tag));
  const unregistered = readdirSync(directory)
    .filter(file => file.endsWith(".sql") && !registered.has(file.slice(0, -4)))
    .map(file => file.slice(0, -4)).sort();
  expect(unregistered).toEqual(legacy.sort());
});
