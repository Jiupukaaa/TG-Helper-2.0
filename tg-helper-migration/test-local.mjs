#!/usr/bin/env node
/**
 * End-to-end local test of the export -> D1 conversion pipeline.
 *
 * It uses PGlite (real PostgreSQL compiled to WASM) with the project's actual
 * Prisma migrations, inserts synthetic rows, builds the same JSON snapshot that
 * export-neon.mjs produces, converts it with to-d1.mjs, imports the result into
 * SQLite (the engine behind D1) and verifies counts, FKs and values.
 *
 * Run: node test-local.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = import.meta.dirname;
const migrationsDir = path.join(here, "..", "prisma", "migrations");
const workDir = path.join(here, "test", "out");

const TABLES = ["users", "shifts", "notes", "saved_items", "reminders", "sessions"];

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const db = new PGlite();
const migrationNames = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const name of migrationNames) {
  const sql = await readFile(path.join(migrationsDir, name, "migration.sql"), "utf8");
  try {
    await db.exec(sql);
  } catch (error) {
    console.error(`Migration failed: ${name}`);
    throw error;
  }
}
console.log(`Applied ${migrationNames.length} Prisma migrations`);

await db.exec(await readFile(path.join(here, "test", "seed.sql"), "utf8"));
console.log("Seeded synthetic rows");

const snapshot = {
  version: 1,
  generatedAt: new Date().toISOString(),
  tables: {},
};
for (const table of TABLES) {
  const result = await db.query(`SELECT * FROM "${table}" ORDER BY "id"`);
  snapshot.tables[table] = result.rows;
}

const snapshotPath = path.join(workDir, "snapshot.json");
await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

const d1Dir = path.join(workDir, "d1");
execFileSync(process.execPath, [path.join(here, "to-d1.mjs"), snapshotPath, d1Dir], {
  stdio: "inherit",
});

const d1Sql = await readFile(path.join(d1Dir, "d1.sql"), "utf8");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(d1Sql);

for (const table of TABLES) {
  const expected = snapshot.tables[table].length;
  const actual = sqlite.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c;
  assert(actual === expected, `${table}: expected ${expected} rows, got ${actual}`);
}

const brokenFks = sqlite.prepare("PRAGMA foreign_key_check").all();
assert(brokenFks.length === 0, `foreign_key_check returned ${JSON.stringify(brokenFks)}`);

const integrity = sqlite.prepare("PRAGMA integrity_check").get().integrity_check;
assert(integrity === "ok", `integrity_check returned ${integrity}`);

const note1 = sqlite.prepare(`SELECT text FROM notes WHERE id = 1`).get().text;
assert(note1 === `O'Brien said "hi"`, `note 1 text was ${JSON.stringify(note1)}`);

const note2 = sqlite.prepare(`SELECT text FROM notes WHERE id = 2`).get().text;
assert(note2 === "Line 1\nLine 2 — юникод", `note 2 text was ${JSON.stringify(note2)}`);

const user1 = sqlite.prepare(`SELECT "createdAt", "updatedAt", "telegramId" FROM users WHERE id = 1`).get();
assert(user1.createdAt === "2026-09-01T10:00:00.123Z", `users.createdAt was ${user1.createdAt}`);
assert(user1.updatedAt === "2026-09-02T11:00:00.456Z", `users.updatedAt was ${user1.updatedAt}`);
assert(user1.telegramId === 1001, `users.telegramId was ${user1.telegramId}`);

const reminder2 = sqlite.prepare(`SELECT status, "dueAt", "repeatRule" FROM reminders WHERE id = 2`).get();
assert(reminder2.status === "SENT", `reminder 2 status was ${reminder2.status}`);
assert(reminder2.dueAt === "2026-09-10T10:00:00.000Z", `reminder 2 dueAt was ${reminder2.dueAt}`);
assert(reminder2.repeatRule === "daily", `reminder 2 repeatRule was ${reminder2.repeatRule}`);

const session1 = sqlite.prepare(`SELECT step, draft FROM sessions WHERE id = 1`).get();
assert(session1.step === "NOTE_AWAITING_TEXT", `session 1 step was ${session1.step}`);
assert(JSON.parse(session1.draft).nested.x === 2, `session 1 draft was ${session1.draft}`);

const savedTypes = sqlite.prepare(`SELECT group_concat(type, ',') AS types FROM saved_items ORDER BY id`).get().types;
assert(savedTypes === "LINK,PHOTO,GIF", `saved item types were ${savedTypes}`);

// A new row must receive an id greater than the imported maximum.
sqlite.exec(`INSERT INTO users ("telegramId", "updatedAt") VALUES (2001, '2026-10-22T00:00:00.000Z')`);
const newId = sqlite.prepare(`SELECT id FROM users WHERE "telegramId" = 2001`).get().id;
assert(newId === 3, `expected next user id 3, got ${newId}`);

sqlite.close();
await db.close();

console.log("");
console.log("OK: PostgreSQL -> JSON -> D1 SQL -> SQLite verified");
console.log(`Artifacts: ${workDir}`);
