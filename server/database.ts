import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Schema, applied in order. Each entry is one migration; `PRAGMA user_version`
 * says how many have run. Plaintext throughout — see docs/adr/0001.
 *
 * 1 — fabric (+ FTS5).  2 — pattern, views, requirements, notion (+ FTS5).
 * 3 — thread, tool (+ FTS5).  4 — project and its allocations.
 * 5 — account and audit_log.  6 — fabric photos.  7 — tags.
 * 8 — pattern files (the owned PDF and its thumbnail).
 * 9 — photos on every record: `fabric_photo` becomes `photo`, keyed by
 *     entity type + id; the existing rows are copied byte-for-byte as
 *     `entity_type = 'fabric'`.
 * 10 — search reaches the small records: notion and project join the FTS set.
 * 11 — provenance on a fabric: `artist` (who designed the print) and
 *     `repurchase_url` (where this came from). `artist` is searchable, which
 *     means rebuilding `fabric_fts` — external-content FTS5 cannot be altered
 *     in place, so the triggers are rewritten and the index repopulated.
 *     `repurchase_url` stays out of the index: it is a link, not a question.
 * 12 — cuts: a fabric is the cloth and holds one or more `fabric_cut` rows,
 *     each with its own length, remaining length, price and acquisition date.
 *     The fabric's totals become derived (a SUM over cuts), and a project
 *     names the cut it took: `project_fabric` becomes `project_cut`. The
 *     backfill gives every existing fabric exactly one cut carrying the values
 *     its row held, and every existing allocation points at that cut.
 */
/** Exported for the migration tests: they build an older schema and step it forward. */
export const MIGRATIONS: string[] = [
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

  `CREATE TABLE tag (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   -- Names are unique case-insensitively: 'Linen' and 'linen' are one tag.
   CREATE UNIQUE INDEX tag_name_unique ON tag(name COLLATE NOCASE);

   CREATE TABLE tag_link (
     tag_id      TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
     entity_type TEXT NOT NULL,
     entity_id   TEXT NOT NULL,
     PRIMARY KEY (tag_id, entity_type, entity_id)
   );
   CREATE INDEX tag_link_entity_idx ON tag_link(entity_type, entity_id);`,

   // One owned PDF per pattern. The bytes are a row for the same reason photos
   // are: one database file is the whole record, and a backup is one copy.
   // The thumbnail is rendered client-side (docs/technical-design.md §7).
   `CREATE TABLE pattern_file (
      id                     TEXT PRIMARY KEY,
      pattern_id             TEXT NOT NULL UNIQUE REFERENCES pattern(id) ON DELETE CASCADE,
      filename               TEXT NOT NULL,
      content_type           TEXT NOT NULL,
      page_count             INTEGER,
      pdf_bytes              BLOB NOT NULL,
      thumbnail_content_type TEXT,
      thumbnail_bytes        BLOB,
      thumbnail_width_px     INTEGER,
      thumbnail_height_px    INTEGER,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    );`,

   // Photos on every record. `entity_id` cannot carry a foreign key to six
   // tables at once, so the repositories delete a record's photos explicitly —
   // the cascade the old fabric_photo FK provided is now a deliberate step.
   `CREATE TABLE photo (
      id           TEXT PRIMARY KEY,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      position     INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      bytes        BLOB NOT NULL,
      width_px     INTEGER,
      height_px    INTEGER,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX photo_entity_idx ON photo(entity_type, entity_id, position);

    INSERT INTO photo (id, entity_type, entity_id, position, content_type, bytes, width_px, height_px, created_at)
      SELECT id, 'fabric', fabric_id, position, content_type, bytes, width_px, height_px, created_at
        FROM fabric_photo;
    DROP TABLE fabric_photo;`,

   // The stash you most need to search is the one holding the most small
   // records, and notions are exactly that. Projects too — returned last, and
   // labelled clearly, because a project is about what you did, not what you
   // have. External-content FTS5, trigger-fed, like the other four.
   `CREATE VIRTUAL TABLE notion_fts USING fts5(
      name, colour, spec, location, notes,
      content='notion', content_rowid='rowid'
    );
    CREATE TRIGGER notion_after_insert AFTER INSERT ON notion BEGIN
      INSERT INTO notion_fts(rowid, name, colour, spec, location, notes)
      VALUES (new.rowid, new.name, new.colour, new.spec, new.location, new.notes);
    END;
    CREATE TRIGGER notion_after_delete AFTER DELETE ON notion BEGIN
      INSERT INTO notion_fts(notion_fts, rowid, name, colour, spec, location, notes)
      VALUES ('delete', old.rowid, old.name, old.colour, old.spec, old.location, old.notes);
    END;
    CREATE TRIGGER notion_after_update AFTER UPDATE ON notion BEGIN
      INSERT INTO notion_fts(notion_fts, rowid, name, colour, spec, location, notes)
      VALUES ('delete', old.rowid, old.name, old.colour, old.spec, old.location, old.notes);
      INSERT INTO notion_fts(rowid, name, colour, spec, location, notes)
      VALUES (new.rowid, new.name, new.colour, new.spec, new.location, new.notes);
    END;

    CREATE VIRTUAL TABLE project_fts USING fts5(
      title, notes,
      content='project', content_rowid='rowid'
    );
    CREATE TRIGGER project_after_insert AFTER INSERT ON project BEGIN
      INSERT INTO project_fts(rowid, title, notes)
      VALUES (new.rowid, new.title, new.notes);
    END;
    CREATE TRIGGER project_after_delete AFTER DELETE ON project BEGIN
      INSERT INTO project_fts(project_fts, rowid, title, notes)
      VALUES ('delete', old.rowid, old.title, old.notes);
    END;
    CREATE TRIGGER project_after_update AFTER UPDATE ON project BEGIN
      INSERT INTO project_fts(project_fts, rowid, title, notes)
      VALUES ('delete', old.rowid, old.title, old.notes);
      INSERT INTO project_fts(rowid, title, notes)
      VALUES (new.rowid, new.title, new.notes);
    END;

    -- Existing rows index now; the triggers only keep it current from here.
    INSERT INTO notion_fts(rowid, name, colour, spec, location, notes)
      SELECT rowid, name, colour, spec, location, notes FROM notion;
    INSERT INTO project_fts(rowid, title, notes)
      SELECT rowid, title, notes FROM project;`,

   `ALTER TABLE fabric ADD COLUMN repurchase_url TEXT;
    ALTER TABLE fabric ADD COLUMN artist TEXT;

    -- 'artist' is searchable, and external-content FTS5 cannot be altered in
    -- place: the triggers are rewritten and the index repopulated from the
    -- table, so nothing is lost and no reindex step is asked of the operator.
    DROP TRIGGER fabric_after_insert;
    DROP TRIGGER fabric_after_delete;
    DROP TRIGGER fabric_after_update;
    DROP TABLE fabric_fts;
    CREATE VIRTUAL TABLE fabric_fts USING fts5(
      name, fibre, colour, print_type, location, notes, artist,
      content='fabric', content_rowid='rowid'
    );
    CREATE TRIGGER fabric_after_insert AFTER INSERT ON fabric BEGIN
      INSERT INTO fabric_fts(rowid, name, fibre, colour, print_type, location, notes, artist)
      VALUES (new.rowid, new.name, new.fibre, new.colour, new.print_type, new.location, new.notes, new.artist);
    END;
    CREATE TRIGGER fabric_after_delete AFTER DELETE ON fabric BEGIN
      INSERT INTO fabric_fts(fabric_fts, rowid, name, fibre, colour, print_type, location, notes, artist)
      VALUES ('delete', old.rowid, old.name, old.fibre, old.colour, old.print_type, old.location, old.notes, old.artist);
    END;
    CREATE TRIGGER fabric_after_update AFTER UPDATE ON fabric BEGIN
      INSERT INTO fabric_fts(fabric_fts, rowid, name, fibre, colour, print_type, location, notes, artist)
      VALUES ('delete', old.rowid, old.name, old.fibre, old.colour, old.print_type, old.location, old.notes, old.artist);
      INSERT INTO fabric_fts(rowid, name, fibre, colour, print_type, location, notes, artist)
      VALUES (new.rowid, new.name, new.fibre, new.colour, new.print_type, new.location, new.notes, new.artist);
    END;
    INSERT INTO fabric_fts(rowid, name, fibre, colour, print_type, location, notes, artist)
      SELECT rowid, name, fibre, colour, print_type, location, notes, artist FROM fabric;`,

   // Cuts. The fabric is the cloth; the cut is the physical piece. One backfill
   // cut per fabric carries the values the fabric row held — a stash that never
   // split a bolt reads exactly as it did. `project_cut` replaces
   // `project_fabric`: a project now names the cut it took, and every existing
   // allocation points at the one cut its fabric got in the backfill. The
   // fabric's own length/price columns are dropped rather than kept as a
   // second truth — every total is a SUM over cuts from here on.
   `CREATE TABLE fabric_cut (
      id                 TEXT PRIMARY KEY,
      fabric_id          TEXT NOT NULL REFERENCES fabric(id) ON DELETE CASCADE,
      position           INTEGER NOT NULL,
      length_mm          INTEGER,
      original_length_mm INTEGER,
      cost_minor         INTEGER,
      currency           TEXT,
      acquired_on        TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX fabric_cut_fabric_idx ON fabric_cut(fabric_id, position);

    INSERT INTO fabric_cut (id, fabric_id, position, length_mm, original_length_mm,
                            cost_minor, currency, acquired_on, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), id, 0, length_mm, original_length_mm,
             cost_minor, currency, acquired_on, created_at, updated_at
        FROM fabric;

    CREATE TABLE project_cut (
      project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      cut_id         TEXT NOT NULL REFERENCES fabric_cut(id) ON DELETE CASCADE,
      length_mm_used INTEGER,
      PRIMARY KEY (project_id, cut_id)
    );
    INSERT INTO project_cut (project_id, cut_id, length_mm_used)
      SELECT pf.project_id, fc.id, pf.length_mm_used
        FROM project_fabric pf
        JOIN fabric_cut fc ON fc.fabric_id = pf.fabric_id;
    DROP TABLE project_fabric;

    ALTER TABLE fabric DROP COLUMN length_mm;
    ALTER TABLE fabric DROP COLUMN original_length_mm;
    ALTER TABLE fabric DROP COLUMN cost_minor;
    ALTER TABLE fabric DROP COLUMN currency;
    ALTER TABLE fabric DROP COLUMN acquired_on;`,
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
