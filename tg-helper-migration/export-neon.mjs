#!/usr/bin/env node
/**
 * Export TG-Helper 2.0 from Neon PostgreSQL to a portable JSON snapshot.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgresql://user:pass@host/db?sslmode=require"
 *   node export-neon.mjs .\neon-export
 *
 * Output:
 *   neon-export/snapshot.json       - everything in one file
 *   neon-export/tables/<name>.json  - one file per table
 *   neon-export/manifest.json       - row counts + SHA-256 checksums
 *
 * The script is read-only. It does not create, update or delete anything.
 *
 * Why not pg_dump: pg_dump produces PostgreSQL SQL that cannot be executed by
 * SQLite/D1. This snapshot keeps the data in a driver-neutral JSON form, so it
 * can be converted to D1 (see to-d1.mjs) or imported into a Durable Object.
 */
import pg from "pg";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { Client, types } = pg;

// All bigint values in this schema (telegramId and ids) are far below 2^53.
types.setTypeParser(20, (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
});
// Prisma maps DateTime to timestamp(3) WITHOUT time zone and stores UTC.
// pg would otherwise parse it in the local timezone and shift the value.
types.setTypeParser(1114, (value) => new Date(`${value.replace(" ", "T")}Z`));
types.setTypeParser(1184, (value) => new Date(value));
types.setTypeParser(1082, (value) => value);

// Insert order respects foreign keys.
const TABLES = [
  { name: "users", orderBy: "id" },
  { name: "shifts", orderBy: "id" },
  { name: "notes", orderBy: "id" },
  { name: "saved_items", orderBy: "id" },
  { name: "reminders", orderBy: "id" },
  { name: "sessions", orderBy: "id" },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function explainError(error) {
  const message = String(error?.message ?? error);
  if (message.includes("402") || /quota/i.test(message)) {
    return [
      "Neon вернул HTTP 402: квота исчерпана, compute приостановлен.",
      "Данные не удалены. Доступ вернётся после сброса квоты (2026-11-01T00:00:00Z)",
      "или сразу после перехода организации на план Launch.",
      "",
      `Исходная ошибка: ${message}`,
    ].join("\n");
  }
  return message;
}

const outDir = path.resolve(process.argv[2] ?? "neon-export");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  console.error('PowerShell: $env:DATABASE_URL = "postgresql://..."');
  process.exit(1);
}

// Neon always requires TLS. Accept a URL without sslmode too.
const url = new URL(databaseUrl);
if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");

const client = new Client({
  connectionString: url.toString(),
  application_name: "tg-helper-export",
});

const snapshot = {
  version: 1,
  generatedAt: new Date().toISOString(),
  tables: {},
};
const manifest = {
  version: 1,
  generatedAt: snapshot.generatedAt,
  source: {},
  tables: {},
};

try {
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET statement_timeout = '300s'");

  const versionResult = await client.query("SHOW server_version");
  manifest.source.serverVersion = versionResult.rows[0]?.server_version ?? null;
  manifest.source.database = (await client.query("SELECT current_database() AS name")).rows[0]?.name ?? null;

  const publicTables = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  manifest.source.publicTables = publicTables.rows.map((row) => row.table_name);

  const exported = new Set(TABLES.map((table) => table.name));
  const skipped = manifest.source.publicTables.filter(
    (name) => !exported.has(name) && name !== "_prisma_migrations",
  );
  if (skipped.length > 0) {
    console.warn(`WARNING: tables not in the export list: ${skipped.join(", ")}`);
  }

  await mkdir(path.join(outDir, "tables"), { recursive: true });

  for (const table of TABLES) {
    const sql = `SELECT * FROM "${table.name}" ORDER BY "${table.orderBy}"`;
    const result = await client.query(sql);
    const rows = result.rows;

    snapshot.tables[table.name] = rows;

    const json = JSON.stringify(rows, null, 2);
    const file = path.join(outDir, "tables", `${table.name}.json`);
    await writeFile(file, `${json}\n`, "utf8");

    manifest.tables[table.name] = {
      rows: rows.length,
      bytes: Buffer.byteLength(json, "utf8"),
      sha256: sha256(json),
      file: path.relative(outDir, file).replaceAll("\\", "/"),
    };

    console.log(`${table.name.padEnd(14)} ${String(rows.length).padStart(7)} rows`);
  }

  const snapshotJson = JSON.stringify(snapshot);
  await writeFile(path.join(outDir, "snapshot.json"), snapshotJson, "utf8");
  manifest.snapshot = {
    bytes: Buffer.byteLength(snapshotJson, "utf8"),
    sha256: sha256(snapshotJson),
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`Snapshot: ${path.join(outDir, "snapshot.json")}`);
  console.log(`SHA-256:  ${manifest.snapshot.sha256}`);
  console.log("");
  console.log("Next: node to-d1.mjs .\\neon-export\\snapshot.json .\\d1-export");
} catch (error) {
  console.error(explainError(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
