import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Photo, TaggableType } from '../../shared/model'
import { RecordConflictError, RecordNotFoundError } from '../errors'

type Row = Record<string, unknown>

/** The kinds of record that can carry a photo — the taggable set. */
export const PHOTO_ENTITY_TYPES = ['fabric', 'thread', 'notion', 'tool', 'pattern', 'project'] as const
export type PhotoEntityType = (typeof PHOTO_ENTITY_TYPES)[number]

export const isPhotoEntityType = (value: string): value is PhotoEntityType =>
  (PHOTO_ENTITY_TYPES as readonly string[]).includes(value)

/** Where each kind of record lives, for the existence check and the `updated_at` bump. */
const PARENT_TABLES: Record<PhotoEntityType, string> = {
  fabric: 'fabric',
  thread: 'thread',
  notion: 'notion',
  tool: 'tool',
  pattern: 'pattern',
  project: 'project',
}

/** Metadata only; the bytes are fetched by id so a list never loads image data. */
const PHOTO_COLUMNS = `id, entity_type, entity_id, position, content_type, width_px, height_px,
  LENGTH(bytes) AS byte_size, created_at`

/** A sane ceiling: photos are rows, so the database carries them. */
export const MAX_PHOTOS_PER_RECORD = 20

export interface PhotoInput {
  contentType: string
  bytes: Buffer
  widthPx: number | null
  heightPx: number | null
}

const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

function toPhoto(row: Row): Photo {
  return {
    id: String(row.id),
    entityType: String(row.entity_type) as PhotoEntityType,
    entityId: String(row.entity_id),
    position: Number(row.position),
    contentType: String(row.content_type),
    widthPx: row.width_px === null || row.width_px === undefined ? null : Number(row.width_px),
    heightPx: row.height_px === null || row.height_px === undefined ? null : Number(row.height_px),
    byteSize: Number(row.byte_size),
    createdAt: String(row.created_at),
  }
}

/**
 * Photos on every record: one table, keyed by entity type + id, shared by all
 * six kinds. The old per-kind table (fabric_photo) was generalised before a
 * second caller appeared; there is deliberately no foreign key on `entity_id`,
 * so a record's delete removes its photos explicitly (see `deleteAllFor`).
 */
export class PhotoRepository {
  constructor(private readonly database: Database) {}

  /** Whether the parent record exists — the route answers 404 before touching bytes. */
  parentExists(entityType: PhotoEntityType, entityId: string): boolean {
    const row = this.database
      .prepare(`SELECT 1 AS present FROM ${PARENT_TABLES[entityType]} WHERE id = ?`)
      .get(entityId) as Row | undefined
    return row !== undefined
  }

  /** Photos per entity id, for a set of ids in one query. */
  listFor(entityType: TaggableType, entityIds: readonly string[]): Map<string, Photo[]> {
    const byEntity = new Map<string, Photo[]>()
    for (const id of entityIds) byEntity.set(id, [])
    if (entityIds.length === 0) return byEntity
    const rows = this.database
      .prepare(
        `SELECT ${PHOTO_COLUMNS} FROM photo WHERE entity_type = ? AND entity_id IN (${placeholders(entityIds.length)})
          ORDER BY position ASC, created_at ASC`,
      )
      .all(entityType, ...entityIds) as Row[]
    for (const row of rows) {
      byEntity.get(String(row.entity_id))?.push(toPhoto(row))
    }
    return byEntity
  }

  add(entityType: PhotoEntityType, entityId: string, input: PhotoInput, nowIso: string): Photo {
    if (!this.parentExists(entityType, entityId)) {
      throw new RecordNotFoundError(`No ${entityType} with id ${entityId}.`)
    }
    const countRow = this.database
      .prepare('SELECT COUNT(*) AS n FROM photo WHERE entity_type = ? AND entity_id = ?')
      .get(entityType, entityId) as Row
    if (Number(countRow.n) >= MAX_PHOTOS_PER_RECORD) {
      throw new RecordConflictError(`A record can hold at most ${MAX_PHOTOS_PER_RECORD} photos.`)
    }
    const nextPosition = this.database
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM photo WHERE entity_type = ? AND entity_id = ?')
      .get(entityType, entityId) as Row
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO photo (id, entity_type, entity_id, position, content_type, bytes, width_px, height_px, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, entityType, entityId, Number(nextPosition.next), input.contentType, input.bytes, input.widthPx, input.heightPx, nowIso)
    this.database
      .prepare(`UPDATE ${PARENT_TABLES[entityType]} SET updated_at = ? WHERE id = ?`)
      .run(nowIso, entityId)
    const row = this.database.prepare(`SELECT ${PHOTO_COLUMNS} FROM photo WHERE id = ?`).get(id) as Row
    return toPhoto(row)
  }

  /** The bytes, plus the content type to serve them with. */
  getBytes(entityType: PhotoEntityType, entityId: string, photoId: string): { contentType: string; bytes: Buffer } | null {
    const row = this.database
      .prepare('SELECT content_type, bytes FROM photo WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(photoId, entityType, entityId) as Row | undefined
    if (!row) return null
    return { contentType: String(row.content_type), bytes: Buffer.from(row.bytes as Uint8Array) }
  }

  delete(entityType: PhotoEntityType, entityId: string, photoId: string): void {
    const row = this.database
      .prepare('SELECT 1 AS present FROM photo WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(photoId, entityType, entityId) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No photo ${photoId} on ${entityType} ${entityId}.`)
    this.database.prepare('DELETE FROM photo WHERE id = ?').run(photoId)
  }

  /** What a record's own delete does in place of the foreign key it no longer has. */
  deleteAllFor(entityType: PhotoEntityType, entityId: string): void {
    this.database.prepare('DELETE FROM photo WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
  }
}
