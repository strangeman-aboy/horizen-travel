import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(moduleDirectory, "..");
const defaultDatabasePath = resolve(apiDirectory, "data", "hackathon.sqlite");

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const databasePath = resolve(readArgument("--db") ?? process.env.API_DB_PATH ?? defaultDatabasePath);
const outputPath = resolve(
  readArgument("--output") ??
  resolve(apiDirectory, "backups", `${basename(databasePath, ".sqlite")}-${timestamp()}.sqlite`)
);
const force = process.argv.includes("--force");

if (!existsSync(databasePath)) {
  throw new Error(`Source database does not exist: ${databasePath}`);
}
if (existsSync(outputPath) && !force) {
  throw new Error(`Backup already exists: ${outputPath}. Pass --force to replace it.`);
}

mkdirSync(dirname(outputPath), { recursive: true });
const source = new DatabaseSync(databasePath, { readOnly: true });
try {
  const pages = await backup(source, outputPath);
  const verified = new DatabaseSync(outputPath, { readOnly: true });
  try {
    const quickCheck = verified.prepare("PRAGMA quick_check").get()?.quick_check;
    const foreignKeyViolations = verified.prepare("PRAGMA foreign_key_check").all();
    if (quickCheck !== "ok" || foreignKeyViolations.length > 0) {
      throw new Error(
        `Backup verification failed: quick_check=${quickCheck}, foreign_key_violations=${foreignKeyViolations.length}`
      );
    }
  } finally {
    verified.close();
  }
  console.log(JSON.stringify({
    event: "database_backup_complete",
    source: databasePath,
    output: outputPath,
    pages,
    verified: true
  }));
} finally {
  source.close();
}
