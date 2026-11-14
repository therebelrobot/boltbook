import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Schema, applied in order. Each entry is one migration; `PRAGMA user_version`
 * says how many have run. Plaintext throughout — see docs/adr/0001.
 *
 * 1 — fabric (+ FTS5).  2 — pattern, views, requirements, notion (+ FTS5).
 * 3 — thread, tool (+ FTS5).  4 — project and its allocations.
 * 5 — account and audit_log.  6 — fabric photos.
 * Tags are a later migration; see docs/technical-design.md §3.
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

  `CREATE TABLE thread (
     id                TEXT PRIMARY KEY,
     name              TEXT NOT NULL,
     brand             TEXT,
     colour            TEXT,
     colour_code       TEXT,
     fibre             TEXT,
     weight            TEXT,
     spools            INTEGER,
     length_m          INTEGER,
     original_length_m INTEGER,
     needle_size       TEXT,
     location          TEXT,
     source            TEXT,
     cost_minor        INTEGER,
     currency          TEXT,
     acquired_on       TEXT,
     notes             TEXT,
     created_at        TEXT NOT NULL,
     updated_at        TEXT NOT NULL
   );
   CREATE INDEX thread_colour_idx ON thread(colour);
   CREATE INDEX thread_fibre_idx ON thread(fibre);
   CREATE VIRTUAL TABLE thread_fts USING fts5(
     brand, name, colour, colour_code, fibre, notes,
     content='thread', content_rowid='rowid'
   );
   CREATE TRIGGER thread_after_insert AFTER INSERT ON thread BEGIN
     INSERT INTO thread_fts(rowid, brand, name, colour, colour_code, fibre, notes)
     VALUES (new.rowid, new.brand, new.name, new.colour, new.colour_code, new.fibre, new.notes);
   END;
   CREATE TRIGGER thread_after_delete AFTER DELETE ON thread BEGIN
     INSERT INTO thread_fts(thread_fts, rowid, brand, name, colour, colour_code, fibre, notes)
     VALUES ('delete', old.rowid, old.brand, old.name, old.colour, old.colour_code, old.fibre, old.notes);
   END;
   CREATE TRIGGER thread_after_update AFTER UPDATE ON thread BEGIN
     INSERT INTO thread_fts(thread_fts, rowid, brand, name, colour, colour_code, fibre, notes)
     VALUES ('delete', old.rowid, old.brand, old.name, old.colour, old.colour_code, old.fibre, old.notes);
     INSERT INTO thread_fts(rowid, brand, name, colour, colour_code, fibre, notes)
     VALUES (new.rowid, new.brand, new.name, new.colour, new.colour_code, new.fibre, new.notes);
   END;

   CREATE TABLE tool (
     id              TEXT PRIMARY KEY,
     name            TEXT NOT NULL,
     category        TEXT,
     brand           TEXT,
     spec            TEXT,
     quantity        INTEGER,
     location        TEXT,
     needs_attention INTEGER NOT NULL DEFAULT 0,
     acquired_on     TEXT,
     cost_minor      INTEGER,
     currency        TEXT,
     notes           TEXT,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL
   );
   CREATE INDEX tool_category_idx ON tool(category);
   CREATE VIRTUAL TABLE tool_fts USING fts5(
     name, brand, category, spec, notes,
     content='tool', content_rowid='rowid'
   );
   CREATE TRIGGER tool_after_insert AFTER INSERT ON tool BEGIN
     INSERT INTO tool_fts(rowid, name, brand, category, spec, notes)
     VALUES (new.rowid, new.name, new.brand, new.category, new.spec, new.notes);
   END;
   CREATE TRIGGER tool_after_delete AFTER DELETE ON tool BEGIN
     INSERT INTO tool_fts(tool_fts, rowid, name, brand, category, spec, notes)
     VALUES ('delete', old.rowid, old.name, old.brand, old.category, old.spec, old.notes);
   END;
   CREATE TRIGGER tool_after_update AFTER UPDATE ON tool BEGIN
     INSERT INTO tool_fts(tool_fts, rowid, name, brand, category, spec, notes)
     VALUES ('delete', old.rowid, old.name, old.brand, old.category, old.spec, old.notes);
     INSERT INTO tool_fts(rowid, name, brand, category, spec, notes)
     VALUES (new.rowid, new.name, new.brand, new.category, new.spec, new.notes);
   END;`,

  `CREATE TABLE project (
     id              TEXT PRIMARY KEY,
     title           TEXT NOT NULL,
     pattern_view_id TEXT REFERENCES pattern_view(id) ON DELETE SET NULL,
     status          TEXT NOT NULL DEFAULT 'planned',
     consumed        INTEGER NOT NULL DEFAULT 0,
     started_on      TEXT,
     finished_on     TEXT,
     notes           TEXT,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL
   );
   CREATE INDEX project_status_idx ON project(status);
   CREATE INDEX project_view_idx ON project(pattern_view_id);

   CREATE TABLE project_fabric (
     project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
     fabric_id      TEXT NOT NULL REFERENCES fabric(id) ON DELETE CASCADE,
     length_mm_used INTEGER,
     PRIMARY KEY (project_id, fabric_id)
   );
   CREATE TABLE project_thread (
     project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
     thread_id     TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
     length_m_used INTEGER,
     PRIMARY KEY (project_id, thread_id)
   );
   CREATE TABLE project_notion (
     project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
     notion_id    TEXT NOT NULL REFERENCES notion(id) ON DELETE CASCADE,
     quantity_used REAL,
     PRIMARY KEY (project_id, notion_id)
   );`,

  `CREATE TABLE account (
     singleton_id              INTEGER PRIMARY KEY CHECK (singleton_id = 1),
     created_at                TEXT NOT NULL,
     scrypt_n                  INTEGER NOT NULL,
     scrypt_r                  INTEGER NOT NULL,
     scrypt_p                  INTEGER NOT NULL,
     passphrase_salt           BLOB NOT NULL,
     passphrase_hash           BLOB NOT NULL,
     totp_secret               TEXT,
     totp_last_accepted_counter INTEGER
   );

   CREATE TABLE audit_log (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     at         TEXT NOT NULL,
     event      TEXT NOT NULL,
     ip_address TEXT NOT NULL,
     user_agent TEXT NOT NULL
   );`,

  `CREATE TABLE fabric_photo (
     id           TEXT PRIMARY KEY,
     fabric_id    TEXT NOT NULL REFERENCES fabric(id) ON DELETE CASCADE,
     position     INTEGER NOT NULL,
     content_type TEXT NOT NULL,
     bytes        BLOB NOT NULL,
     width_px     INTEGER,
     height_px    INTEGER,
     created_at   TEXT NOT NULL
   );
   CREATE INDEX fabric_photo_fabric_idx ON fabric_photo(fabric_id, position);`,
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
