import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(moduleDirectory, "..");
const defaultDatabasePath = resolve(apiDirectory, "data", "hackathon.sqlite");

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const databasePath = resolve(readArgument("--db") ?? process.env.API_DB_PATH ?? defaultDatabasePath);
if (!existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const quickCheck = db.prepare("PRAGMA quick_check").get()?.quick_check;
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  const hasMigrationTable = db.prepare(`
    SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get();
  const schemaVersion = hasMigrationTable
    ? db.prepare(`
        SELECT COALESCE(MAX(version), 0) AS version
        FROM schema_migrations
      `).get()?.version ?? 0
    : 0;
  const counts = {};
  for (const table of ["imports", "trips", "trip_revisions", "execution_events"]) {
    const exists = db.prepare(`
      SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    counts[table] = exists
      ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
      : null;
  }

  console.log(JSON.stringify({
    event: "database_check",
    database: databasePath,
    ok: quickCheck === "ok" && foreignKeyViolations.length === 0,
    quickCheck,
    foreignKeyViolations: foreignKeyViolations.length,
    schemaVersion,
    counts
  }, null, 2));
  if (quickCheck !== "ok" || foreignKeyViolations.length > 0) process.exitCode = 1;
} finally {
  db.close();
}
