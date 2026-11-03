import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve(process.env.MIGRATION_EXPORT_PATH ?? ".migration/neon-export.json");
const outputPath = resolve(process.env.D1_IMPORT_SQL_PATH ?? ".migration/d1-import.sql");
const exportData = JSON.parse(await readFile(inputPath, "utf8"));
if (exportData.formatVersion !== 1 || !exportData.tables) throw new Error("Unsupported or invalid Neon export format.");

const schema = [
  ["users", ["id", "telegramId", "timezone", "createdAt", "updatedAt"]],
  ["notes", ["id", "text", "voiceFileId", "ownerId", "createdAt", "updatedAt"]],
  ["saved_items", ["id", "type", "url", "fileId", "ownerId", "createdAt", "updatedAt"]],
  ["shifts", ["id", "name", "startAt", "ownerId", "cycleGroupId", "createdAt", "updatedAt"]],
  ["reminders", ["id", "text", "voiceFileId", "dueAt", "status", "processingStartedAt", "sentAt", "retryCount", "lastError", "ownerId", "shiftId", "offsetMinutes", "repeatGroupId", "repeatRule", "createdAt", "updatedAt"]],
  ["sessions", ["id", "userId", "step", "draft", "updatedAt"]],
];

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite numeric value in export.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") value = JSON.stringify(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}

const statements = [
  "-- Generated from a local Neon export. Review row counts before applying.",
  "-- Target D1 must be empty; this script does not delete existing rows.",
];
for (const [table, columns] of schema) {
  const rows = exportData.tables[table];
  if (!Array.isArray(rows)) throw new Error("Missing table in export: " + table);
  for (const row of rows) {
    const values = columns.map((column) => {
      if (!Object.hasOwn(row, column)) throw new Error("Missing " + table + "." + column + " in export.");
      return sqlValue(row[column]);
    });
    const names = columns.map((column) => '"' + column + '"').join(", ");
    statements.push('INSERT INTO "' + table + '" (' + names + ") VALUES (" + values.join(", ") + ");");
  }
}
await writeFile(outputPath, statements.join("\n") + "\n", { mode: 0o600 });
console.log("Prepared D1 import SQL: " + outputPath);
for (const [table] of schema) console.log(table + ": " + exportData.tables[table].length + " rows");
console.log("Review counts and ensure the target database is empty before importing.");
