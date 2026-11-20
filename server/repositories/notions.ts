import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Notion, NotionFilters, NotionInput, NotionKind } from '../../shared/model'
import { TagsRepository } from './tags'
import { PhotoRepository } from './photos'
import { RecordNotFoundError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, kind, colour, spec, quantity, unit, location, notes, created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function toNotion(row: Row, photos: Notion['photos'], tags: string[]): Notion {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: nullableText(row.kind) as NotionKind | null,
    colour: nullableText(row.colour),
    spec: nullableText(row.spec),
    quantity: nullableNumber(row.quantity),
    unit: nullableText(row.unit),
    location: nullableText(row.location),
    notes: nullableText(row.notes),
    photos,
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const valuesOf = (input: NotionInput): Array<string | number | null> => [
  input.name,
  input.kind,
  input.colour,
  input.spec,
  input.quantity,
  input.unit,
  input.location,
  input.notes,
]

export class NotionRepository {
  private readonly tags: TagsRepository
  private readonly photos: PhotoRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
    this.photos = new PhotoRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM notion').get() as Row
    return Number(row.n)
  }

  list(filters: NotionFilters = {}): Notion[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.kind) {
      where.push('kind = ?')
      parameters.push(filters.kind)
    }
    if (filters.location) {
      where.push('location = ? COLLATE NOCASE')
      parameters.push(filters.location)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'notion' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM notion ${clause} ORDER BY kind ASC, name ASC`)
      .all(...parameters) as Row[]
    const ids = rows.map((row) => String(row.id))
    const photos = this.photos.listFor('notion', ids)
    const tags = this.tags.namesFor('notion', ids)
    return rows.map((row) => toNotion(row, photos.get(String(row.id)) ?? [], tags.get(String(row.id)) ?? []))
  }

  get(id: string): Notion | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM notion WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toNotion(row, this.photos.listFor('notion', [id]).get(id) ?? [], this.tags.namesFor('notion', [id]).get(id) ?? [])
  }

  #require(id: string): Notion {
    const notion = this.get(id)
    if (!notion) throw new RecordNotFoundError(`No notion with id ${id}.`)
    return notion
  }

  create(input: NotionInput, nowIso: string): Notion {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO notion (id, name, kind, colour, spec, quantity, unit, location, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
    this.tags.setFor('notion', id, input.tags, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: NotionInput, nowIso: string): Notion {
    this.#require(id)
    this.database
      .prepare(
        `UPDATE notion SET name = ?, kind = ?, colour = ?, spec = ?, quantity = ?, unit = ?,
          location = ?, notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(...valuesOf(input), nowIso, id)
    this.tags.setFor('notion', id, input.tags, nowIso)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    // No foreign key reaches the shared photo table, so the cascade is a step.
    this.photos.deleteAllFor('notion', id)
    this.database.prepare('DELETE FROM notion WHERE id = ?').run(id)
  }
}
