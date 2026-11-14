import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Thread, ThreadFilters, ThreadInput } from '../../shared/model'
import { TagsRepository } from './tags'
import { RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, brand, colour, colour_code, fibre, weight, spools, length_m,
  original_length_m, needle_size, location, source, cost_minor, currency, acquired_on, notes,
  created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function toThread(row: Row, tags: string[]): Thread {
  return {
    id: String(row.id),
    name: String(row.name),
    brand: nullableText(row.brand),
    colour: nullableText(row.colour),
    colourCode: nullableText(row.colour_code),
    fibre: nullableText(row.fibre),
    weight: nullableText(row.weight),
    spools: nullableNumber(row.spools),
    lengthM: nullableNumber(row.length_m),
    originalLengthM: nullableNumber(row.original_length_m),
    needleSize: nullableText(row.needle_size),
    location: nullableText(row.location),
    source: nullableText(row.source),
    costMinor: nullableNumber(row.cost_minor),
    currency: nullableText(row.currency),
    acquiredOn: nullableText(row.acquired_on),
    notes: nullableText(row.notes),
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const valuesOf = (input: ThreadInput): Array<string | number | null> => [
  input.name,
  input.brand,
  input.colour,
  input.colourCode,
  input.fibre,
  input.weight,
  input.spools,
  input.lengthM,
  input.originalLengthM,
  input.needleSize,
  input.location,
  input.source,
  input.costMinor,
  input.currency,
  input.acquiredOn,
  input.notes,
]

export class ThreadRepository {
  private readonly tags: TagsRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM thread').get() as Row
    return Number(row.n)
  }

  list(filters: ThreadFilters = {}): Thread[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.colour) {
      where.push('colour = ? COLLATE NOCASE')
      parameters.push(filters.colour)
    }
    if (filters.fibre) {
      where.push('fibre = ? COLLATE NOCASE')
      parameters.push(filters.fibre)
    }
    if (filters.location) {
      where.push('location = ? COLLATE NOCASE')
      parameters.push(filters.location)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'thread' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM thread ${clause} ORDER BY brand ASC, name ASC, colour ASC`)
      .all(...parameters) as Row[]
    const tags = this.tags.namesFor('thread', rows.map((row) => String(row.id)))
    return rows.map((row) => toThread(row, tags.get(String(row.id)) ?? []))
  }

  get(id: string): Thread | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM thread WHERE id = ?`).get(id) as Row | undefined
    return row ? toThread(row, this.tags.namesFor('thread', [id]).get(id) ?? []) : null
  }

  #require(id: string): Thread {
    const thread = this.get(id)
    if (!thread) throw new RecordNotFoundError(`No thread with id ${id}.`)
    return thread
  }

  create(input: ThreadInput, nowIso: string): Thread {
    assertThreadInvariant(input)
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO thread (id, name, brand, colour, colour_code, fibre, weight, spools, length_m,
          original_length_m, needle_size, location, source, cost_minor, currency, acquired_on, notes,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
    this.tags.setFor('thread', id, input.tags, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: ThreadInput, nowIso: string): Thread {
    this.#require(id)
    assertThreadInvariant(input)
    this.database
      .prepare(
        `UPDATE thread SET name = ?, brand = ?, colour = ?, colour_code = ?, fibre = ?, weight = ?,
          spools = ?, length_m = ?, original_length_m = ?, needle_size = ?, location = ?, source = ?,
          cost_minor = ?, currency = ?, acquired_on = ?, notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(...valuesOf(input), nowIso, id)
    this.tags.setFor('thread', id, input.tags, nowIso)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM thread WHERE id = ?').run(id)
  }
}

export function assertThreadInvariant(input: ThreadInput): void {
  if (input.lengthM !== null && input.originalLengthM !== null && input.lengthM > input.originalLengthM) {
    throw new RecordValidationError('Remaining thread length cannot exceed the original length.')
  }
}
