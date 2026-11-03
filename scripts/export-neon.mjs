import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const connectionString = process.env.SOURCE_DATABASE_URL;
if (!connectionString) throw new Error("Set SOURCE_DATABASE_URL locally to the existing PostgreSQL connection string.");

const tables = ["users", "notes", "saved_items", "shifts", "reminders", "sessions"];
const outputPath = resolve(process.env.MIGRATION_EXPORT_PATH ?? ".migration/neon-export.json");
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const data = { formatVersion: 1, exportedAt: new Date().toISOString(), source: "neon-postgresql", tables: {} };
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM "${table}" ORDER BY "id" ASC`);
    data.tables[table] = result.rows;
    console.log(`${table}: ${result.rowCount} rows`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(`Export written to ${outputPath}. It may contain private notes and Telegram IDs; do not commit or share it.`);
} finally {
  await client.end();
}
