#!/usr/bin/env node
/**
 * Convert a snapshot produced by export-neon.mjs into SQLite/D1 SQL.
 *
 * Usage:
 *   node to-d1.mjs .\neon-export\snapshot.json .\d1-export
 *
 * Output:
 *   d1-export/schema.sql  - DDL (tables, indexes, checks)
 *   d1-export/data.sql    - INSERT statements only
 *   d1-export/d1.sql      - schema + data, ready for `wrangler d1 import`
 *   d1-export/verify.sql  - row counts + foreign key check
 *
 * This is intentionally a raw-SQL schema. If you keep Prisma on D1, generate
 * the Prisma schema separately and compare column types before importing.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const snapshotPath = path.resolve(process.argv[2] ?? "neon-export/snapshot.json");
const outDir = path.resolve(process.argv[3] ?? "d1-export");

// Insert order respects foreign keys.
const TABLES = [
  {
    name: "users",
    columns: ["id", "telegramId", "timezone", "createdAt", "updatedAt"],
  },
  {
    name: "shifts",
    columns: ["id", "name", "startAt", "ownerId", "cycleGroupId", "createdAt", "updatedAt"],
  },
  {
    name: "notes",
    columns: ["id", "text", "voiceFileId", "ownerId", "createdAt", "updatedAt"],
  },
  {
    name: "saved_items",
    columns: ["id", "type", "url", "fileId", "ownerId", "createdAt", "updatedAt"],
  },
  {
    name: "reminders",
    columns: [
      "id",
      "text",
      "voiceFileId",
      "dueAt",
      "status",
      "processingStartedAt",
      "sentAt",
      "retryCount",
      "lastError",
      "ownerId",
      "shiftId",
      "offsetMinutes",
      "repeatGroupId",
      "repeatRule",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "sessions",
    columns: ["id", "userId", "step", "draft", "updatedAt"],
  },
];

const INTEGER_COLUMNS = new Set([
  "id",
  "telegramId",
  "ownerId",
  "shiftId",
  "offsetMinutes",
  "retryCount",
  "userId",
]);

const TIMESTAMP_COLUMNS = new Set([
  "createdAt",
  "updatedAt",
  "dueAt",
  "processingStartedAt",
  "sentAt",
  "startAt",
]);

const JSON_COLUMNS = new Set(["draft"]);

const SESSION_STEPS = [
  "IDLE",
  "NOTE_AWAITING_TEXT",
  "NOTE_EDIT_AWAITING_TEXT",
  "NOTE_VOICE_REPLACE_AWAITING",
  "REMINDER_AWAITING_TEXT",
  "REMINDER_AWAITING_DATETIME",
  "SHIFT_MANUAL_AWAITING_TIME",
  "SHIFT_MANUAL_AWAITING_NAME",
  "SHIFT_CYCLE_AWAITING_WORK_DAYS",
  "SHIFT_CYCLE_AWAITING_OFF_DAYS",
  "SHIFT_CYCLE_AWAITING_START_DATE",
  "SHIFT_CYCLE_AWAITING_TIME",
  "SHIFT_CYCLE_AWAITING_END_DATE",
  "SHIFT_CYCLE_AWAITING_NAME",
  "SHIFT_EDIT_AWAITING_NAME",
];

const SCHEMA = `-- TG-Helper 2.0 - SQLite/D1 schema
-- Generated from prisma/schema.prisma and prisma/migrations/*.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "users" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "telegramId" INTEGER NOT NULL,
  "timezone"  TEXT NOT NULL DEFAULT 'UTC',
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegramId_key" ON "users" ("telegramId");

CREATE TABLE IF NOT EXISTS "shifts" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"        TEXT,
  "startAt"     TEXT NOT NULL,
  "ownerId"     INTEGER NOT NULL,
  "cycleGroupId" TEXT,
  "createdAt"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt"   TEXT NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "shifts_ownerId_startAt_key" ON "shifts" ("ownerId", "startAt");
CREATE INDEX IF NOT EXISTS "shifts_ownerId_startAt_idx" ON "shifts" ("ownerId", "startAt");
CREATE INDEX IF NOT EXISTS "shifts_ownerId_cycleGroupId_idx" ON "shifts" ("ownerId", "cycleGroupId");

CREATE TABLE IF NOT EXISTS "notes" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "text"        TEXT NOT NULL,
  "voiceFileId" TEXT,
  "ownerId"     INTEGER NOT NULL,
  "createdAt"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt"   TEXT NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "notes_ownerId_idx" ON "notes" ("ownerId");

CREATE TABLE IF NOT EXISTS "saved_items" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "type"      TEXT NOT NULL CHECK ("type" IN ('LINK', 'PHOTO', 'GIF')),
  "url"       TEXT,
  "fileId"    TEXT,
  "ownerId"   INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "saved_items_ownerId_idx" ON "saved_items" ("ownerId");

CREATE TABLE IF NOT EXISTS "reminders" (
  "id"                  INTEGER PRIMARY KEY AUTOINCREMENT,
  "text"                TEXT NOT NULL,
  "voiceFileId"         TEXT,
  "dueAt"               TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  "processingStartedAt" TEXT,
  "sentAt"              TEXT,
  "retryCount"          INTEGER NOT NULL DEFAULT 0,
  "lastError"           TEXT,
  "ownerId"             INTEGER NOT NULL,
  "shiftId"             INTEGER,
  "offsetMinutes"       INTEGER,
  "repeatGroupId"       TEXT,
  "repeatRule"          TEXT CHECK ("repeatRule" IS NULL OR "repeatRule" IN ('daily', 'weekly', 'monthly')),
  "createdAt"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt"           TEXT NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("shiftId") REFERENCES "shifts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminders_shiftId_offsetMinutes_key"
  ON "reminders" ("shiftId", "offsetMinutes");
CREATE INDEX IF NOT EXISTS "reminders_status_dueAt_idx" ON "reminders" ("status", "dueAt");
CREATE INDEX IF NOT EXISTS "reminders_ownerId_idx" ON "reminders" ("ownerId");
CREATE INDEX IF NOT EXISTS "reminders_shiftId_idx" ON "reminders" ("shiftId");
CREATE INDEX IF NOT EXISTS "reminders_ownerId_repeatGroupId_idx"
  ON "reminders" ("ownerId", "repeatGroupId");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "userId"    INTEGER NOT NULL,
  "step"      TEXT NOT NULL DEFAULT 'IDLE'
              CHECK ("step" IN (${SESSION_STEPS.map((step) => `'${step}'`).join(", ")})),
  "draft"     TEXT CHECK ("draft" IS NULL OR json_valid("draft")),
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_userId_key" ON "sessions" ("userId");
`;

function sqlString(value) {
  if (value.includes("\u0000")) throw new Error("NUL byte is not supported in a SQL literal");
  return `'${value.replaceAll("'", "''")}'`;
}

function identify(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();

  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
    text = text.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) {
    text += "Z";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${JSON.stringify(value)}`);
  }
  return date.toISOString();
}

function normalizeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    JSON.parse(value); // throw early on malformed JSON
    return value;
  }
  return JSON.stringify(value);
}

function toSqlValue(column, value) {
  if (value === null || value === undefined) return "NULL";

  if (TIMESTAMP_COLUMNS.has(column)) return sqlString(normalizeTimestamp(value));
  if (JSON_COLUMNS.has(column)) {
    const json = normalizeJson(value);
    return json === null ? "NULL" : sqlString(json);
  }

  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in "${column}"`);
    return String(value);
  }
  if (typeof value === "string") {
    if (INTEGER_COLUMNS.has(column)) {
      if (!/^-?\d+$/.test(value)) throw new Error(`Expected integer in "${column}", got ${JSON.stringify(value)}`);
      return value;
    }
    return sqlString(value);
  }
  if (typeof value === "object") {
    return sqlString(JSON.stringify(value));
  }
  throw new Error(`Unsupported value in "${column}": ${typeof value}`);
}

function insertStatements(table, rows) {
  if (rows.length === 0) return [];

  const columns = table.columns.map(identify).join(", ");
  const prefix = `INSERT INTO ${identify(table.name)} (${columns}) VALUES\n`;
  const statements = [];
  let batch = [];

  const flush = () => {
    if (batch.length === 0) return;
    statements.push(`${prefix}${batch.join(",\n")};`);
    batch = [];
  };

  for (const row of rows) {
    const unknown = Object.keys(row).filter((key) => !table.columns.includes(key));
    if (unknown.length > 0) {
      throw new Error(`Unexpected column(s) in ${table.name}: ${unknown.join(", ")}`);
    }
    const values = table.columns.map((column) => toSqlValue(column, row[column]));
    const tuple = `  (${values.join(", ")})`;
    batch.push(tuple);
    // Stay well below D1's 100 KB SQL statement limit.
    if (batch.length >= 50 || batch.join(",\n").length >= 80_000) flush();
  }
  flush();
  return statements;
}

const snapshotRaw = await readFile(snapshotPath, "utf8");
const snapshot = JSON.parse(snapshotRaw);
if (snapshot.version !== 1 || typeof snapshot.tables !== "object") {
  throw new Error(`Unsupported snapshot format in ${snapshotPath}`);
}

const dataParts = [
  "-- TG-Helper 2.0 - data",
  `-- Source: ${path.basename(snapshotPath)}`,
  `-- Generated: ${new Date().toISOString()}`,
  "",
];
const summary = { tables: {}, totalRows: 0 };

for (const table of TABLES) {
  const rows = snapshot.tables[table.name];
  if (!Array.isArray(rows)) {
    throw new Error(`Table "${table.name}" is missing from the snapshot`);
  }
  const statements = insertStatements(table, rows);
  if (statements.length > 0) {
    dataParts.push(`-- ${table.name}: ${rows.length} rows`, ...statements, "");
  }
  summary.tables[table.name] = rows.length;
  summary.totalRows += rows.length;
  console.log(`${table.name.padEnd(14)} ${String(rows.length).padStart(7)} rows -> ${statements.length} INSERT statement(s)`);
}

const verifyParts = [
  "-- Row counts",
  TABLES.map((table) => `SELECT '${table.name}' AS table_name, count(*) AS rows FROM ${identify(table.name)}`).join("\nUNION ALL\n") + ";",
  "",
  "-- Empty result = no broken foreign keys",
  "PRAGMA foreign_key_check;",
  "",
  "-- Must print 'ok'",
  "PRAGMA quick_check;",
  "",
];

const dataSql = dataParts.join("\n");
const d1Sql = `${SCHEMA}\n${dataSql}`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "schema.sql"), SCHEMA, "utf8");
await writeFile(path.join(outDir, "data.sql"), dataSql, "utf8");
await writeFile(path.join(outDir, "d1.sql"), d1Sql, "utf8");
await writeFile(path.join(outDir, "verify.sql"), verifyParts.join("\n"), "utf8");

summary.snapshotSha256 = createHash("sha256").update(snapshotRaw).digest("hex");
summary.d1SqlBytes = Buffer.byteLength(d1Sql, "utf8");
summary.d1SqlSha256 = createHash("sha256").update(d1Sql).digest("hex");
await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log("");
console.log(`Schema: ${path.join(outDir, "schema.sql")}`);
console.log(`Data:   ${path.join(outDir, "data.sql")}`);
console.log(`D1:     ${path.join(outDir, "d1.sql")} (${(summary.d1SqlBytes / 1024).toFixed(1)} KiB)`);
console.log(`Verify: ${path.join(outDir, "verify.sql")}`);
console.log(`Rows:   ${summary.totalRows}`);
