import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Tool, ToolCategory, ToolFilters, ToolInput } from '../../shared/model'
import { TagsRepository } from './tags'
import { PhotoRepository } from './photos'
import { RecordNotFoundError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, category, brand, spec, quantity, location, needs_attention,
  acquired_on, cost_minor, currency, notes, created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function toTool(row: Row, photos: Tool['photos'], tags: string[]): Tool {
  return {
    id: String(row.id),
    name: String(row.name),
    category: nullableText(row.category) as ToolCategory | null,
    brand: nullableText(row.brand),
    spec: nullableText(row.spec),
    quantity: nullableNumber(row.quantity),
    location: nullableText(row.location),
    needsAttention: Number(row.needs_attention) === 1,
    acquiredOn: nullableText(row.acquired_on),
    costMinor: nullableNumber(row.cost_minor),
    currency: nullableText(row.currency),
    notes: nullableText(row.notes),
    photos,
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const valuesOf = (input: ToolInput): Array<string | number | null> => [
  input.name,
  input.category,
  input.brand,
  input.spec,
  input.quantity,
  input.location,
  input.needsAttention ? 1 : 0,
  input.acquiredOn,
  input.costMinor,
  input.currency,
  input.notes,
]

export class ToolRepository {
  private readonly tags: TagsRepository
  private readonly photos: PhotoRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
    this.photos = new PhotoRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM tool').get() as Row
    return Number(row.n)
  }

  list(filters: ToolFilters = {}): Tool[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.category) {
      where.push('category = ?')
      parameters.push(filters.category)
    }
    if (filters.location) {
      where.push('location = ? COLLATE NOCASE')
      parameters.push(filters.location)
    }
    if (filters.needsAttention !== undefined) {
      where.push('needs_attention = ?')
      parameters.push(filters.needsAttention ? 1 : 0)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'tool' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM tool ${clause} ORDER BY category ASC, name ASC`)
      .all(...parameters) as Row[]
    const ids = rows.map((row) => String(row.id))
    const photos = this.photos.listFor('tool', ids)
    const tags = this.tags.namesFor('tool', ids)
    return rows.map((row) => toTool(row, photos.get(String(row.id)) ?? [], tags.get(String(row.id)) ?? []))
  }

  get(id: string): Tool | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM tool WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toTool(row, this.photos.listFor('tool', [id]).get(id) ?? [], this.tags.namesFor('tool', [id]).get(id) ?? [])
  }

  #require(id: string): Tool {
    const tool = this.get(id)
    if (!tool) throw new RecordNotFoundError(`No tool with id ${id}.`)
    return tool
  }

  create(input: ToolInput, nowIso: string): Tool {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO tool (id, name, category, brand, spec, quantity, location, needs_attention,
          acquired_on, cost_minor, currency, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
    this.tags.setFor('tool', id, input.tags, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: ToolInput, nowIso: string): Tool {
    this.#require(id)
    this.database
      .prepare(
        `UPDATE tool SET name = ?, category = ?, brand = ?, spec = ?, quantity = ?, location = ?,
          needs_attention = ?, acquired_on = ?, cost_minor = ?, currency = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(...valuesOf(input), nowIso, id)
    this.tags.setFor('tool', id, input.tags, nowIso)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    // No foreign key reaches the shared photo table, so the cascade is a step.
    this.photos.deleteAllFor('tool', id)
    this.database.prepare('DELETE FROM tool WHERE id = ?').run(id)
  }
}
