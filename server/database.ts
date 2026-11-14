import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Schema, applied in order. Each entry is one migration; `PRAGMA user_version`
 * says how many have run. Plaintext throughout — see docs/adr/0001.
 *
 * 1 — fabric (+ FTS5).  2 — pattern, views, requirements, notion (+ FTS5).
 * Projects, tags, the account and the audit log are later migrations; see
 * docs/technical-design.md §3.
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

  `CREATE TABLE pattern (
     id             TEXT PRIMARY KEY,
     name           TEXT NOT NULL,
     brand          TEXT,
     number         TEXT,
     format         TEXT,
     size_min       TEXT,
     size_max       TEXT,
     difficulty     TEXT,
     category       TEXT,
     source         TEXT,
     year           INTEGER,
     tried_and_true INTEGER NOT NULL DEFAULT 0,
     link_url       TEXT,
     notes          TEXT,
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL
   );
   CREATE INDEX pattern_brand_idx ON pattern(brand);
   CREATE INDEX pattern_category_idx ON pattern(category);

   CREATE TABLE pattern_view (
     id          TEXT PRIMARY KEY,
     pattern_id  TEXT NOT NULL REFERENCES pattern(id) ON DELETE CASCADE,
     label       TEXT NOT NULL,
     description TEXT,
     position    INTEGER NOT NULL
   );
   CREATE INDEX pattern_view_pattern_idx ON pattern_view(pattern_id);

   CREATE TABLE pattern_requirement (
     id              TEXT PRIMARY KEY,
     pattern_view_id TEXT NOT NULL REFERENCES pattern_view(id) ON DELETE CASCADE,
     role            TEXT NOT NULL,
     fabric_width_mm INTEGER,
     length_mm       INTEGER,
     note            TEXT
   );
   CREATE INDEX pattern_requirement_view_idx ON pattern_requirement(pattern_view_id);

   CREATE TABLE notion (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     kind       TEXT,
     colour     TEXT,
     spec       TEXT,
     quantity   REAL,
     unit       TEXT,
     location   TEXT,
     notes      TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX notion_kind_idx ON notion(kind);

   CREATE VIRTUAL TABLE pattern_fts USING fts5(
     brand, number, name, category, notes,
     content='pattern', content_rowid='rowid'
   );
   CREATE TRIGGER pattern_after_insert AFTER INSERT ON pattern BEGIN
     INSERT INTO pattern_fts(rowid, brand, number, name, category, notes)
     VALUES (new.rowid, new.brand, new.number, new.name, new.category, new.notes);
   END;
   CREATE TRIGGER pattern_after_delete AFTER DELETE ON pattern BEGIN
     INSERT INTO pattern_fts(pattern_fts, rowid, brand, number, name, category, notes)
     VALUES ('delete', old.rowid, old.brand, old.number, old.name, old.category, old.notes);
   END;
   CREATE TRIGGER pattern_after_update AFTER UPDATE ON pattern BEGIN
     INSERT INTO pattern_fts(pattern_fts, rowid, brand, number, name, category, notes)
     VALUES ('delete', old.rowid, old.brand, old.number, old.name, old.category, old.notes);
     INSERT INTO pattern_fts(rowid, brand, number, name, category, notes)
     VALUES (new.rowid, new.brand, new.number, new.name, new.category, new.notes);
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
