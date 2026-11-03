import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const connectionString = process.env.SOURCE_DATABASE_URL;
if (!connectionString) throw new Error("Set SOURCE_DATABASE_URL locally to the existing PostgreSQL connection string.");

const tables = ["users", "notes", "saved_items", "shifts", "reminders", "sessions"];
const outputPath = resolve(process.env.MIGRATION_EXPORT_PATH ?? ".migration/neon-export.json");
const client = new Client({ connectionString });

try {
  await client.connect();
  // Use one read-only repeatable-read transaction so all tables represent the
  // same database snapshot while the live bot continues to run.
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const data = { formatVersion: 1, exportedAt: new Date().toISOString(), source: "neon-postgresql", tables: {} };
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM "${table}" ORDER BY "id" ASC`);
    data.tables[table] = result.rows;
    console.log(`${table}: ${result.rowCount} rows`);
  }
  await client.query("COMMIT");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(`Export written to ${outputPath}. It may contain private notes and Telegram IDs; do not commit or share it.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
