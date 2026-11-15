import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type {
  Pattern,
  PatternFile,
  PatternFilters,
  PatternInput,
  PatternRequirement,
  PatternRequirementInput,
  PatternView,
  PatternViewInput,
  RequirementRole,
} from '../../shared/model'
import { TagsRepository } from './tags'
import { RecordNotFoundError } from '../errors'

type Row = Record<string, unknown>

const PATTERN_COLUMNS = `id, name, brand, number, format, size_min, size_max, difficulty,
  category, source, year, tried_and_true, link_url, notes, created_at, updated_at`

/** Metadata only; the PDF bytes are fetched by id so a list never loads a file. */
const FILE_COLUMNS = `id, pattern_id, filename, content_type, page_count,
  LENGTH(pdf_bytes) AS byte_size, thumbnail_content_type, thumbnail_width_px,
  thumbnail_height_px, created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

export interface PatternFileInput {
  filename: string
  contentType: string
  bytes: Buffer
  pageCount: number | null
}

export interface PatternThumbnailInput {
  contentType: string
  bytes: Buffer
  widthPx: number | null
  heightPx: number | null
}

function toFile(row: Row): PatternFile {
  return {
    id: String(row.id),
    patternId: String(row.pattern_id),
    filename: String(row.filename),
    contentType: String(row.content_type),
    pageCount: nullableNumber(row.page_count),
    byteSize: Number(row.byte_size),
    thumbnail: row.thumbnail_content_type
      ? {
          contentType: String(row.thumbnail_content_type),
          widthPx: nullableNumber(row.thumbnail_width_px),
          heightPx: nullableNumber(row.thumbnail_height_px),
        }
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function toRequirement(row: Row): PatternRequirement {
  return {
    id: String(row.id),
    patternViewId: String(row.pattern_view_id),
    role: String(row.role) as RequirementRole,
    fabricWidthMm: nullableNumber(row.fabric_width_mm),
    lengthMm: nullableNumber(row.length_mm),
    note: nullableText(row.note),
  }
}

function toView(row: Row, requirements: PatternRequirement[]): PatternView {
  return {
    id: String(row.id),
    patternId: String(row.pattern_id),
    label: String(row.label),
    description: nullableText(row.description),
    position: Number(row.position),
    requirements,
  }
}

function toPattern(row: Row, views: PatternView[], file: PatternFile | null, tags: string[]): Pattern {
  return {
    id: String(row.id),
    name: String(row.name),
    brand: nullableText(row.brand),
    number: nullableText(row.number),
    format: nullableText(row.format) as Pattern['format'],
    sizeMin: nullableText(row.size_min),
    sizeMax: nullableText(row.size_max),
    difficulty: nullableText(row.difficulty),
    category: nullableText(row.category),
    source: nullableText(row.source),
    year: nullableNumber(row.year),
    triedAndTrue: Number(row.tried_and_true) === 1,
    linkUrl: nullableText(row.link_url),
    notes: nullableText(row.notes),
    views,
    file,
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const PATTERN_VALUES = (input: PatternInput): Array<string | number | null> => [
  input.name,
  input.brand,
  input.number,
  input.format,
  input.sizeMin,
  input.sizeMax,
  input.difficulty,
  input.category,
  input.source,
  input.year,
  input.triedAndTrue ? 1 : 0,
  input.linkUrl,
  input.notes,
]

export class PatternRepository {
  private readonly tags: TagsRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM pattern').get() as Row
    return Number(row.n)
  }

  /** Loads views (and their requirements) for a set of pattern ids in three queries. */
  #viewsByPatternId(patternIds: string[]): Map<string, PatternView[]> {
    const byPattern = new Map<string, PatternView[]>()
    for (const id of patternIds) byPattern.set(id, [])
    if (patternIds.length === 0) return byPattern

    const viewRows = this.database
      .prepare(
        `SELECT * FROM pattern_view WHERE pattern_id IN (${placeholders(patternIds.length)})
          ORDER BY position ASC, label ASC`,
      )
      .all(...patternIds) as Row[]
    const viewIds = viewRows.map((row) => String(row.id))

    const requirementsByView = new Map<string, PatternRequirement[]>()
    if (viewIds.length > 0) {
      const requirementRows = this.database
        .prepare(`SELECT * FROM pattern_requirement WHERE pattern_view_id IN (${placeholders(viewIds.length)})`)
        .all(...viewIds) as Row[]
      for (const row of requirementRows) {
        const viewId = String(row.pattern_view_id)
        const list = requirementsByView.get(viewId) ?? []
        list.push(toRequirement(row))
        requirementsByView.set(viewId, list)
      }
    }

    for (const row of viewRows) {
      const patternId = String(row.pattern_id)
      const list = byPattern.get(patternId) ?? []
      list.push(toView(row, requirementsByView.get(String(row.id)) ?? []))
      byPattern.set(patternId, list)
    }
    return byPattern
  }

  /** One query for every pattern's file metadata, keyed by pattern id. */
  #filesByPatternId(patternIds: string[]): Map<string, PatternFile> {
    const byPattern = new Map<string, PatternFile>()
    if (patternIds.length === 0) return byPattern
    const rows = this.database
      .prepare(`SELECT ${FILE_COLUMNS} FROM pattern_file WHERE pattern_id IN (${placeholders(patternIds.length)})`)
      .all(...patternIds) as Row[]
    for (const row of rows) byPattern.set(String(row.pattern_id), toFile(row))
    return byPattern
  }

  list(filters: PatternFilters = {}): Pattern[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.brand) {
      where.push('brand = ? COLLATE NOCASE')
      parameters.push(filters.brand)
    }
    if (filters.category) {
      where.push('category = ? COLLATE NOCASE')
      parameters.push(filters.category)
    }
    if (filters.format) {
      where.push('format = ?')
      parameters.push(filters.format)
    }
    if (filters.triedAndTrue !== undefined) {
      where.push('tried_and_true = ?')
      parameters.push(filters.triedAndTrue ? 1 : 0)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'pattern' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${PATTERN_COLUMNS} FROM pattern ${clause} ORDER BY updated_at DESC, name ASC`)
      .all(...parameters) as Row[]
    const ids = rows.map((row) => String(row.id))
    const views = this.#viewsByPatternId(ids)
    const files = this.#filesByPatternId(ids)
    const tags = this.tags.namesFor('pattern', ids)
    return rows.map((row) =>
      toPattern(row, views.get(String(row.id)) ?? [], files.get(String(row.id)) ?? null, tags.get(String(row.id)) ?? []),
    )
  }

  get(id: string): Pattern | null {
    const row = this.database.prepare(`SELECT ${PATTERN_COLUMNS} FROM pattern WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toPattern(
      row,
      this.#viewsByPatternId([id]).get(id) ?? [],
      this.#filesByPatternId([id]).get(id) ?? null,
      this.tags.namesFor('pattern', [id]).get(id) ?? [],
    )
  }

  #require(id: string): Row {
    const row = this.database.prepare(`SELECT ${PATTERN_COLUMNS} FROM pattern WHERE id = ?`).get(id) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No pattern with id ${id}.`)
    return row
  }

  create(input: PatternInput, nowIso: string): Pattern {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO pattern (id, name, brand, number, format, size_min, size_max, difficulty,
          category, source, year, tried_and_true, link_url, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...PATTERN_VALUES(input), nowIso, nowIso)
    this.tags.setFor('pattern', id, input.tags, nowIso)
    return this.get(id)!
  }

  replace(id: string, input: PatternInput, nowIso: string): Pattern {
    this.#require(id)
    this.database
      .prepare(
        `UPDATE pattern SET name = ?, brand = ?, number = ?, format = ?, size_min = ?, size_max = ?,
          difficulty = ?, category = ?, source = ?, year = ?, tried_and_true = ?, link_url = ?,
          notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(...PATTERN_VALUES(input), nowIso, id)
    this.tags.setFor('pattern', id, input.tags, nowIso)
    return this.get(id)!
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM pattern WHERE id = ?').run(id)
  }

  // ---------- views ----------

  #requireView(patternId: string, viewId: string): Row {
    const row = this.database
      .prepare('SELECT * FROM pattern_view WHERE id = ? AND pattern_id = ?')
      .get(viewId, patternId) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No view ${viewId} on pattern ${patternId}.`)
    return row
  }

  #view(patternId: string, viewId: string): PatternView {
    const row = this.#requireView(patternId, viewId)
    const requirements = this.database
      .prepare('SELECT * FROM pattern_requirement WHERE pattern_view_id = ?')
      .all(viewId) as Row[]
    return toView(row, requirements.map(toRequirement))
  }

  addView(patternId: string, input: PatternViewInput, nowIso: string): PatternView {
    this.#require(patternId)
    const nextPosition = this.database
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pattern_view WHERE pattern_id = ?')
      .get(patternId) as Row
    const id = randomUUID()
    this.database
      .prepare('INSERT INTO pattern_view (id, pattern_id, label, description, position) VALUES (?, ?, ?, ?, ?)')
      .run(id, patternId, input.label, input.description, Number(nextPosition.next))
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return this.#view(patternId, id)
  }

  replaceView(patternId: string, viewId: string, input: PatternViewInput, nowIso: string): PatternView {
    this.#requireView(patternId, viewId)
    this.database
      .prepare('UPDATE pattern_view SET label = ?, description = ? WHERE id = ?')
      .run(input.label, input.description, viewId)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return this.#view(patternId, viewId)
  }

  deleteView(patternId: string, viewId: string): void {
    this.#requireView(patternId, viewId)
    this.database.prepare('DELETE FROM pattern_view WHERE id = ?').run(viewId)
  }

  // ---------- requirements ----------

  #requireRequirement(viewId: string, requirementId: string): Row {
    const row = this.database
      .prepare('SELECT * FROM pattern_requirement WHERE id = ? AND pattern_view_id = ?')
      .get(requirementId, viewId) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No requirement ${requirementId} on view ${viewId}.`)
    return row
  }

  addRequirement(patternId: string, viewId: string, input: PatternRequirementInput, nowIso: string): PatternRequirement {
    this.#requireView(patternId, viewId)
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO pattern_requirement (id, pattern_view_id, role, fabric_width_mm, length_mm, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, viewId, input.role, input.fabricWidthMm, input.lengthMm, input.note)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return toRequirement(this.#requireRequirement(viewId, id))
  }

  replaceRequirement(
    patternId: string,
    viewId: string,
    requirementId: string,
    input: PatternRequirementInput,
    nowIso: string,
  ): PatternRequirement {
    this.#requireView(patternId, viewId)
    this.#requireRequirement(viewId, requirementId)
    this.database
      .prepare(
        `UPDATE pattern_requirement SET role = ?, fabric_width_mm = ?, length_mm = ?, note = ? WHERE id = ?`,
      )
      .run(input.role, input.fabricWidthMm, input.lengthMm, input.note, requirementId)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return toRequirement(this.#requireRequirement(viewId, requirementId))
  }

  deleteRequirement(patternId: string, viewId: string, requirementId: string, nowIso: string): void {
    this.#requireView(patternId, viewId)
    this.#requireRequirement(viewId, requirementId)
    this.database.prepare('DELETE FROM pattern_requirement WHERE id = ?').run(requirementId)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
  }

  // ---------- the owned PDF ----------

  #file(patternId: string): PatternFile | null {
    return this.#filesByPatternId([patternId]).get(patternId) ?? null
  }

  /** Replacing a file deletes the old row, so the id — and therefore the cache key — changes. */
  addFile(patternId: string, input: PatternFileInput, nowIso: string): PatternFile {
    this.#require(patternId)
    const id = randomUUID()
    this.database.prepare('DELETE FROM pattern_file WHERE pattern_id = ?').run(patternId)
    this.database
      .prepare(
        `INSERT INTO pattern_file (id, pattern_id, filename, content_type, page_count, pdf_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, patternId, input.filename, input.contentType, input.pageCount, input.bytes, nowIso, nowIso)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return this.#file(patternId)!
  }

  setFileThumbnail(
    patternId: string,
    fileId: string,
    input: PatternThumbnailInput,
    nowIso: string,
  ): PatternFile {
    const current = this.#file(patternId)
    if (!current || current.id !== fileId) {
      throw new RecordNotFoundError(`No file ${fileId} on pattern ${patternId}.`)
    }
    this.database
      .prepare(
        `UPDATE pattern_file SET thumbnail_content_type = ?, thumbnail_bytes = ?,
          thumbnail_width_px = ?, thumbnail_height_px = ?, updated_at = ? WHERE id = ?`,
      )
      .run(input.contentType, input.bytes, input.widthPx, input.heightPx, nowIso, fileId)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
    return this.#file(patternId)!
  }

  getFileBytes(patternId: string, fileId: string): { filename: string; contentType: string; bytes: Buffer } | null {
    const row = this.database
      .prepare('SELECT filename, content_type, pdf_bytes FROM pattern_file WHERE id = ? AND pattern_id = ?')
      .get(fileId, patternId) as Row | undefined
    if (!row) return null
    return {
      filename: String(row.filename),
      contentType: String(row.content_type),
      bytes: Buffer.from(row.pdf_bytes as Uint8Array),
    }
  }

  getFileThumbnailBytes(patternId: string, fileId: string): { contentType: string; bytes: Buffer } | null {
    const row = this.database
      .prepare('SELECT thumbnail_content_type, thumbnail_bytes FROM pattern_file WHERE id = ? AND pattern_id = ?')
      .get(fileId, patternId) as Row | undefined
    if (!row || !row.thumbnail_content_type || !row.thumbnail_bytes) return null
    return {
      contentType: String(row.thumbnail_content_type),
      bytes: Buffer.from(row.thumbnail_bytes as Uint8Array),
    }
  }

  deleteFile(patternId: string, nowIso: string): void {
    this.#require(patternId)
    const result = this.database.prepare('DELETE FROM pattern_file WHERE pattern_id = ?').run(patternId)
    if (Number(result.changes) === 0) throw new RecordNotFoundError(`No file on pattern ${patternId}.`)
    this.database.prepare('UPDATE pattern SET updated_at = ? WHERE id = ?').run(nowIso, patternId)
  }
}
