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
 * - `photo.bytes` — the bytes are the `photos/` entries; the JSON keeps
 *   the metadata and the filename to match them up.
 * - `pattern_file.pdf_bytes` and `thumbnail_bytes` — pattern files are records,
 *   so they are exported, but their bytes are the `pattern-files/` entries for
 *   the same reason: base64 would inflate a 20 MB pattern by a third.
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
  patternFileCount: number
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
    .prepare('SELECT id, content_type, bytes FROM photo')
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
    database
      .prepare('SELECT id, entity_type, entity_id, position, content_type, width_px, height_px, created_at FROM photo')
      .all() as Row[]
  ).map((row) => ({ ...row, file: fileByPhotoId.get(String(row.id)) ?? null }))

  // Pattern files: the PDF and its thumbnail become entries; the metadata keeps
  // the pointers. One file per pattern, but written as a list for the reader.
  const patternFileRows = database
    .prepare(
      `SELECT id, pattern_id, filename, content_type, page_count, thumbnail_content_type,
              thumbnail_width_px, thumbnail_height_px, created_at, updated_at,
              LENGTH(pdf_bytes) AS byte_size
         FROM pattern_file`,
    )
    .all() as Row[]
  const patternFileByteRows = database.prepare('SELECT id, pdf_bytes, thumbnail_bytes FROM pattern_file').all() as Row[]
  const bytesByPatternFileId = new Map(patternFileByteRows.map((row) => [String(row.id), row]))
  const patternFileMetadata = patternFileRows.map((row) => {
    const id = String(row.id)
    const bytes = bytesByPatternFileId.get(id)
    const file = `pattern-files/${id}.pdf`
    entries.push({ name: file, data: Buffer.from(bytes?.pdf_bytes as Uint8Array) })
    const thumbnailContentType = row.thumbnail_content_type ? String(row.thumbnail_content_type) : null
    const thumbnailFile =
      thumbnailContentType && bytes?.thumbnail_bytes
        ? `pattern-files/thumbs/${id}.${extensionForContentType(thumbnailContentType)}`
        : null
    if (thumbnailFile && bytes?.thumbnail_bytes) {
      entries.push({ name: thumbnailFile, data: Buffer.from(bytes.thumbnail_bytes as Uint8Array) })
    }
    return { ...row, file, thumbnail_file: thumbnailFile }
  })

  const json = {
    format: 'boltbook-export',
    version: 1,
    exportedAt,
    note: 'Records, tags, photo metadata and pattern files. Bytes are the photos/ and pattern-files/ entries. Credentials are never exported.',
    tables: { ...tables, photo: photoMetadata, pattern_file: patternFileMetadata },
  }

  entries.unshift({ name: 'boltbook.json', data: Buffer.from(JSON.stringify(json, null, 2), 'utf8') })

  return {
    json: entries[0]!.data,
    entries,
    recordCount,
    photoCount: photoRows.length,
    patternFileCount: patternFileRows.length,
  }
}

export function buildExportZip(
  database: Database,
  exportedAt: string,
): { zip: Buffer; recordCount: number; photoCount: number; patternFileCount: number } {
  const built = buildExport(database, exportedAt)
  return {
    zip: createZip(built.entries, new Date(exportedAt)),
    recordCount: built.recordCount,
    photoCount: built.photoCount,
    patternFileCount: built.patternFileCount,
  }
}
