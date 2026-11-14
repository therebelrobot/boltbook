import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Fabric, FabricFilters, FabricInput, FabricPhoto } from '../../shared/model'
import { TagsRepository } from './tags'
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, fibre, weight, length_mm, width_mm, original_length_mm,
  colour, print_type, source, cost_minor, currency, acquired_on, location, care, notes,
  created_at, updated_at`

/** Metadata only; the bytes are fetched by id so a list never loads image data. */
const PHOTO_COLUMNS = `id, fabric_id, position, content_type, width_px, height_px,
  LENGTH(bytes) AS byte_size, created_at`

/** A sane ceiling: photos are rows, so the database carries them. */
export const MAX_PHOTOS_PER_FABRIC = 20

export interface FabricPhotoInput {
  contentType: string
  bytes: Buffer
  widthPx: number | null
  heightPx: number | null
}

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

function toPhoto(row: Row): FabricPhoto {
  return {
    id: String(row.id),
    fabricId: String(row.fabric_id),
    position: Number(row.position),
    contentType: String(row.content_type),
    widthPx: nullableNumber(row.width_px),
    heightPx: nullableNumber(row.height_px),
    byteSize: Number(row.byte_size),
    createdAt: String(row.created_at),
  }
}

function toFabric(row: Row, photos: FabricPhoto[], tags: string[]): Fabric {
  return {
    id: String(row.id),
    name: String(row.name),
    fibre: nullableText(row.fibre),
    weight: nullableText(row.weight),
    lengthMm: nullableNumber(row.length_mm),
    widthMm: nullableNumber(row.width_mm),
    originalLengthMm: nullableNumber(row.original_length_mm),
    colour: nullableText(row.colour),
    printType: nullableText(row.print_type),
    source: nullableText(row.source),
    costMinor: nullableNumber(row.cost_minor),
    currency: nullableText(row.currency),
    acquiredOn: nullableText(row.acquired_on),
    location: nullableText(row.location),
    care: nullableText(row.care),
    notes: nullableText(row.notes),
    photos,
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** The positional values for an insert/update, in COLUMNS order minus id/timestamps. */
function valuesOf(input: FabricInput): Array<string | number | null> {
  return [
    input.name,
    input.fibre,
    input.weight,
    input.lengthMm,
    input.widthMm,
    input.originalLengthMm,
    input.colour,
    input.printType,
    input.source,
    input.costMinor,
    input.currency,
    input.acquiredOn,
    input.location,
    input.care,
    input.notes,
  ]
}

export class FabricRepository {
  private readonly tags: TagsRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM fabric').get() as Row
    return Number(row.n)
  }

  #photosFor(fabricIds: string[]): Map<string, FabricPhoto[]> {
    const byFabric = new Map<string, FabricPhoto[]>()
    for (const id of fabricIds) byFabric.set(id, [])
    if (fabricIds.length === 0) return byFabric
    const rows = this.database
      .prepare(
        `SELECT ${PHOTO_COLUMNS} FROM fabric_photo WHERE fabric_id IN (${placeholders(fabricIds.length)})
          ORDER BY position ASC, created_at ASC`,
      )
      .all(...fabricIds) as Row[]
    for (const row of rows) {
      byFabric.get(String(row.fabric_id))?.push(toPhoto(row))
    }
    return byFabric
  }

  list(filters: FabricFilters = {}): Fabric[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.fibre) {
      where.push('fibre = ? COLLATE NOCASE')
      parameters.push(filters.fibre)
    }
    if (filters.location) {
      where.push('location = ? COLLATE NOCASE')
      parameters.push(filters.location)
    }
    if (filters.minLengthMm !== undefined) {
      where.push('length_mm >= ?')
      parameters.push(filters.minLengthMm)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'fabric' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM fabric ${clause} ORDER BY updated_at DESC, name ASC`)
      .all(...parameters) as Row[]
    const ids = rows.map((row) => String(row.id))
    const photos = this.#photosFor(ids)
    const tags = this.tags.namesFor('fabric', ids)
    return rows.map((row) => toFabric(row, photos.get(String(row.id)) ?? [], tags.get(String(row.id)) ?? []))
  }

  get(id: string): Fabric | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM fabric WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toFabric(row, this.#photosFor([id]).get(id) ?? [], this.tags.namesFor('fabric', [id]).get(id) ?? [])
  }

  #require(id: string): Fabric {
    const fabric = this.get(id)
    if (!fabric) throw new RecordNotFoundError(`No fabric with id ${id}.`)
    return fabric
  }

  create(input: FabricInput, nowIso: string): Fabric {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO fabric (id, name, fibre, weight, length_mm, width_mm, original_length_mm,
          colour, print_type, source, cost_minor, currency, acquired_on, location, care, notes,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
    this.tags.setFor('fabric', id, input.tags, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: FabricInput, nowIso: string): Fabric {
    this.#require(id)
    this.database
      .prepare(
        `UPDATE fabric SET name = ?, fibre = ?, weight = ?, length_mm = ?, width_mm = ?,
          original_length_mm = ?, colour = ?, print_type = ?, source = ?, cost_minor = ?,
          currency = ?, acquired_on = ?, location = ?, care = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(...valuesOf(input), nowIso, id)
    this.tags.setFor('fabric', id, input.tags, nowIso)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM fabric WHERE id = ?').run(id)
  }

  // ---------- photos ----------

  addPhoto(fabricId: string, input: FabricPhotoInput, nowIso: string): FabricPhoto {
    this.#require(fabricId)
    const countRow = this.database
      .prepare('SELECT COUNT(*) AS n FROM fabric_photo WHERE fabric_id = ?')
      .get(fabricId) as Row
    if (Number(countRow.n) >= MAX_PHOTOS_PER_FABRIC) {
      throw new RecordConflictError(`A fabric can hold at most ${MAX_PHOTOS_PER_FABRIC} photos.`)
    }
    const nextPosition = this.database
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM fabric_photo WHERE fabric_id = ?')
      .get(fabricId) as Row
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO fabric_photo (id, fabric_id, position, content_type, bytes, width_px, height_px, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, fabricId, Number(nextPosition.next), input.contentType, input.bytes, input.widthPx, input.heightPx, nowIso)
    this.database.prepare('UPDATE fabric SET updated_at = ? WHERE id = ?').run(nowIso, fabricId)
    return toPhoto(this.database.prepare(`SELECT ${PHOTO_COLUMNS} FROM fabric_photo WHERE id = ?`).get(id) as Row)
  }

  /** The bytes, plus the content type to serve them with. */
  getPhotoBytes(fabricId: string, photoId: string): { contentType: string; bytes: Buffer } | null {
    const row = this.database
      .prepare('SELECT content_type, bytes FROM fabric_photo WHERE id = ? AND fabric_id = ?')
      .get(photoId, fabricId) as Row | undefined
    if (!row) return null
    return { contentType: String(row.content_type), bytes: Buffer.from(row.bytes as Uint8Array) }
  }

  deletePhoto(fabricId: string, photoId: string): void {
    const row = this.database
      .prepare('SELECT 1 AS present FROM fabric_photo WHERE id = ? AND fabric_id = ?')
      .get(photoId, fabricId) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No photo ${photoId} on fabric ${fabricId}.`)
    this.database.prepare('DELETE FROM fabric_photo WHERE id = ?').run(photoId)
  }
}

export function assertFabricInvariant(input: FabricInput): void {
  if (input.lengthMm !== null && input.originalLengthMm !== null && input.lengthMm > input.originalLengthMm) {
    throw new RecordValidationError('Remaining length cannot exceed the original length.')
  }
}
