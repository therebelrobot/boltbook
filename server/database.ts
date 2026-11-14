import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Schema, applied in order. Each entry is one migration; `PRAGMA user_version`
 * says how many have run. Plaintext throughout — see docs/adr/0001.
 *
 * Milestone 1 covers fabric. Patterns, notions, projects, tags, the account and
 * the audit log are later migrations; see docs/technical-design.md §3.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE fabric (
     id                 TEXT PRIMARY KEY,
     name               TEXT NOT NULL,
     fibre              TEXT,
     weight             TEXT,
     length_mm          INTEGER,
     width_mm           INTEGER,
     original_length_mm INTEGER,
     colour             TEXT,
     print_type         TEXT,
     source             TEXT,
     cost_minor         INTEGER,
     currency           TEXT,
     acquired_on        TEXT,
     location           TEXT,
     care               TEXT,
     notes              TEXT,
     created_at         TEXT NOT NULL,
     updated_at         TEXT NOT NULL
   );
   CREATE INDEX fabric_fibre_idx ON fabric(fibre);
   CREATE INDEX fabric_location_idx ON fabric(location);

   -- External-content FTS5: the index mirrors the table; triggers keep it current.
   CREATE VIRTUAL TABLE fabric_fts USING fts5(
     name, fibre, colour, print_type, location, notes,
     content='fabric', content_rowid='rowid'
   );
   CREATE TRIGGER fabric_after_insert AFTER INSERT ON fabric BEGIN
     INSERT INTO fabric_fts(rowid, name, fibre, colour, print_type, location, notes)
     VALUES (new.rowid, new.name, new.fibre, new.colour, new.print_type, new.location, new.notes);
   END;
   CREATE TRIGGER fabric_after_delete AFTER DELETE ON fabric BEGIN
     INSERT INTO fabric_fts(fabric_fts, rowid, name, fibre, colour, print_type, location, notes)
     VALUES ('delete', old.rowid, old.name, old.fibre, old.colour, old.print_type, old.location, old.notes);
   END;
   CREATE TRIGGER fabric_after_update AFTER UPDATE ON fabric BEGIN
     INSERT INTO fabric_fts(fabric_fts, rowid, name, fibre, colour, print_type, location, notes)
     VALUES ('delete', old.rowid, old.name, old.fibre, old.colour, old.print_type, old.location, old.notes);
     INSERT INTO fabric_fts(rowid, name, fibre, colour, print_type, location, notes)
     VALUES (new.rowid, new.name, new.fibre, new.colour, new.print_type, new.location, new.notes);
   END;`,
]

export type Database = DatabaseSync

export function openDatabase(databaseFilePath: string): Database {
  if (databaseFilePath !== ':memory:') {
    mkdirSync(path.dirname(databaseFilePath), { recursive: true, mode: 0o700 })
  }
  const database = new DatabaseSync(databaseFilePath)
  if (databaseFilePath !== ':memory:') {
    try {
      chmodSync(databaseFilePath, 0o600)
    } catch {
      // Non-fatal: some bind mounts do not allow chmod.
    }
  }
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA secure_delete = ON;')
  runMigrations(database)
  return database
}

function runMigrations(database: Database): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as { user_version: number }
  let schemaVersion = versionRow.user_version
  while (schemaVersion < MIGRATIONS.length) {
    const migrationSql = MIGRATIONS[schemaVersion]!
    database.exec('BEGIN')
    try {
      database.exec(migrationSql)
      database.exec(`PRAGMA user_version = ${schemaVersion + 1}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    schemaVersion += 1
  }
}
