#!/usr/bin/env node
/**
 * Full end-to-end test of the real export-neon.mjs over the PostgreSQL wire
 * protocol, using PGlite + pglite-socket as the server.
 *
 * Run: node test-export.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = import.meta.dirname;
const migrationsDir = path.join(here, "..", "prisma", "migrations");
const outDir = path.join(here, "test", "out-export");

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Spawn asynchronously: the PGlite socket server lives in this process. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const db = await PGlite.create();
for (const name of (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  await db.exec(await readFile(path.join(migrationsDir, name, "migration.sql"), "utf8"));
}
await db.exec(await readFile(path.join(here, "test", "seed.sql"), "utf8"));
console.log("PGlite: migrations + seed applied");

const server = new PGLiteSocketServer({ db, port: 55432, host: "127.0.0.1" });
await server.start();
console.log("PGlite socket server: 127.0.0.1:55432");

try {
  await run(process.execPath, [path.join(here, "export-neon.mjs"), outDir], {
    env: {
      ...process.env,
      // sslmode=disable is important: pglite-socket does not terminate TLS.
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable",
    },
  });

  const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
  for (const [table, info] of Object.entries(manifest.tables)) {
    assert(info.rows > 0, `${table} exported 0 rows`);
  }
  assert(manifest.tables.users.rows === 2, `users rows = ${manifest.tables.users.rows}`);
  assert(manifest.tables.reminders.rows === 4, `reminders rows = ${manifest.tables.reminders.rows}`);
  assert(manifest.tables.sessions.rows === 2, `sessions rows = ${manifest.tables.sessions.rows}`);

  const d1Dir = path.join(outDir, "d1");
  await run(process.execPath, [path.join(here, "to-d1.mjs"), path.join(outDir, "snapshot.json"), d1Dir]);

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(path.join(d1Dir, "d1.sql"), "utf8"));
  const total = ["users", "shifts", "notes", "saved_items", "reminders", "sessions"]
    .map((table) => sqlite.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c)
    .reduce((sum, count) => sum + count, 0);
  assert(total === 17, `expected 17 rows in SQLite, got ${total}`);
  const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
  assert(fk.length === 0, `foreign_key_check: ${JSON.stringify(fk)}`);
  const createdAt = sqlite.prepare(`SELECT "createdAt" FROM users WHERE id = 1`).get().createdAt;
  assert(createdAt === "2026-09-01T10:00:00.123Z", `timestamp shifted: ${createdAt}`);
  sqlite.close();

  console.log("");
  console.log("OK: real export-neon.mjs -> to-d1.mjs -> SQLite verified");
  console.log(`Artifacts: ${outDir}`);
} finally {
  await server.stop();
  await db.close();
}
