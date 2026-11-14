import type { Database } from './database'
import { readZip } from './zip'
import { RecordValidationError } from './errors'

type Row = Record<string, unknown>

/**
 * Restoring an export.
 *
 * **Import replaces every record.** Merging was considered and rejected for now:
 * a restore should reproduce a known state, and a half-merged stash is harder to
 * reason about than a replaced one. Asking for it explicitly (`mode=replace`) is
 * the guard, so a stray POST can never wipe a stash.
 *
 * Two things are deliberately *not* restored:
 * - `account` — never exported in the first place (credentials are not data).
 * - `audit_log` — the log belongs to this instance and should record that an
 *   import happened, not be overwritten by the history of another box.
 */

/** Children before parents, so no delete cascades into a row we still need. */
const DELETE_ORDER = [
  'tag_link',
  'project_fabric',
  'project_thread',
  'project_notion',
  'project',
  'fabric_photo',
  'pattern_requirement',
  'pattern_view',
  'pattern',
  'fabric',
  'thread',
  'notion',
  'tool',
  'tag',
] as const

/** Parents before children, so every foreign key already exists. */
const INSERT_ORDER = [
  'fabric',
  'thread',
  'notion',
  'tool',
  'pattern',
  'pattern_view',
  'pattern_requirement',
  'project',
  'project_fabric',
  'project_thread',
  'project_notion',
  'tag',
  'tag_link',
] as const

export interface ImportResult {
  tables: Record<string, number>
  photoCount: number
}

export function importExport(database: Database, zip: Buffer): ImportResult {
  let entries: Map<string, Buffer>
  try {
    entries = readZip(zip)
  } catch {
    throw new RecordValidationError('That file is not a readable zip archive.')
  }

  const manifest = entries.get('boltbook.json')
  if (!manifest) throw new RecordValidationError('That zip has no boltbook.json in it.')

  let document: { format?: unknown; version?: unknown; tables?: unknown }
  try {
    document = JSON.parse(manifest.toString('utf8')) as typeof document
  } catch {
    throw new RecordValidationError('boltbook.json is not valid JSON.')
  }

  if (document.format !== 'boltbook-export') throw new RecordValidationError('That is not a boltbook export.')
  if (document.version !== 1) throw new RecordValidationError(`Unsupported export version: ${String(document.version)}.`)
  if (typeof document.tables !== 'object' || document.tables === null) {
    throw new RecordValidationError('That export has no tables in it.')
  }
  const tables = document.tables as Record<string, Row[]>

  // Columns come from the schema, never from the file, so a hand-edited export
  // can add values but cannot invent an identifier.
  const columnsOf = (table: string): string[] =>
    (database.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name))

  const insert = (table: string, row: Row): void => {
    const columns = columnsOf(table).filter((column) => column in row)
    if (columns.length === 0) return
    const placeholders = columns.map(() => '?').join(', ')
    const values = columns.map((column) => (row[column] ?? null) as string | number | bigint | Uint8Array | null)
    database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  }

  const counts: Record<string, number> = {}
  let photoCount = 0

  database.exec('BEGIN')
  try {
    for (const table of DELETE_ORDER) database.prepare(`DELETE FROM ${table}`).run()

    for (const table of INSERT_ORDER) {
      const rows = Array.isArray(tables[table]) ? tables[table]! : []
      for (const row of rows) insert(table, row)
      counts[table] = rows.length
    }

    // Photos: the metadata comes from the JSON, the bytes from the zip entries.
    const photoRows = Array.isArray(tables.fabric_photo) ? tables.fabric_photo! : []
    for (const row of photoRows) {
      const file = typeof row.file === 'string' ? entries.get(row.file) : undefined
      if (!file) continue
      const withBytes: Row = { ...row, bytes: file }
      delete withBytes.file
      insert('fabric_photo', withBytes)
      photoCount += 1
    }
    counts.fabric_photo = photoCount

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    // A foreign-key failure here means the export is inconsistent, not that the
    // instance is broken: nothing was written.
    if (error instanceof RecordValidationError) throw error
    throw new RecordValidationError(`That export could not be restored: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  return { tables: counts, photoCount }
}
