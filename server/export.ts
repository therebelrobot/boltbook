import type { Database } from './database'
import { createZip, extensionForContentType, type ZipEntry } from './zip'

type Row = Record<string, unknown>

/**
 * Everything, in one zip: `boltbook.json` for the records and `photos/` for the
 * image bytes, which are kept out of the JSON so the export is not a third
 * larger than it needs to be.
 *
 * Two deliberate exclusions:
 * - `account` — the export is your data, not your credentials. Restoring it
 *   should never carry a passphrase hash or an authenticator secret with it.
 * - `fabric_photo.bytes` — the bytes are the `photos/` entries; the JSON keeps
 *   the metadata and the filename to match them up.
 */
const TABLES = [
  'fabric',
  'pattern',
  'pattern_view',
  'pattern_requirement',
  'notion',
  'thread',
  'tool',
  'project',
  'project_fabric',
  'project_thread',
  'project_notion',
  'tag',
  'tag_link',
  'audit_log',
] as const

export interface BuiltExport {
  json: Buffer
  entries: ZipEntry[]
  recordCount: number
  photoCount: number
}

export function buildExport(database: Database, exportedAt: string): BuiltExport {
  const tables: Record<string, Row[]> = {}
  let recordCount = 0
  for (const table of TABLES) {
    const rows = database.prepare(`SELECT * FROM ${table}`).all() as Row[]
    tables[table] = rows
    recordCount += rows.length
  }

  // Photo bytes become files; the JSON keeps the metadata and how to find them.
  const photoRows = database
    .prepare('SELECT id, fabric_id, content_type, bytes FROM fabric_photo')
    .all() as Row[]
  const entries: ZipEntry[] = []
  const files: Array<{ id: string; file: string }> = []
  for (const row of photoRows) {
    const file = `photos/${String(row.id)}.${extensionForContentType(String(row.content_type))}`
    files.push({ id: String(row.id), file })
    entries.push({ name: file, data: Buffer.from(row.bytes as Uint8Array) })
  }
  const fileByPhotoId = new Map(files.map((entry) => [entry.id, entry.file]))

  const photoMetadata = (
    database.prepare('SELECT id, fabric_id, position, content_type, width_px, height_px, created_at FROM fabric_photo').all() as Row[]
  ).map((row) => ({ ...row, file: fileByPhotoId.get(String(row.id)) ?? null }))

  const json = {
    format: 'boltbook-export',
    version: 1,
    exportedAt,
    note: 'Records, tags and photo metadata. Photo bytes are the photos/ entries. Credentials are never exported.',
    tables: { ...tables, fabric_photo: photoMetadata },
  }

  entries.unshift({ name: 'boltbook.json', data: Buffer.from(JSON.stringify(json, null, 2), 'utf8') })

  return { json: entries[0]!.data, entries, recordCount, photoCount: photoRows.length }
}

export function buildExportZip(database: Database, exportedAt: string): { zip: Buffer; recordCount: number; photoCount: number } {
  const built = buildExport(database, exportedAt)
  return { zip: createZip(built.entries, new Date(exportedAt)), recordCount: built.recordCount, photoCount: built.photoCount }
}
