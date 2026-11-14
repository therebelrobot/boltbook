import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Fabric, FabricFilters, FabricInput, SearchHit } from '../../shared/model'
import { RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, fibre, weight, length_mm, width_mm, original_length_mm,
  colour, print_type, source, cost_minor, currency, acquired_on, location, care, notes,
  created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function toFabric(row: Row): Fabric {
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** The positional values for an insert/update, in COLUMNS order minus id/timestamps. */
function valuesOf(input: FabricInput): Array<string | number | null> {
  return [
    input.name,
    input.fibre ?? null,
    input.weight ?? null,
    input.lengthMm ?? null,
    input.widthMm ?? null,
    input.originalLengthMm ?? null,
    input.colour ?? null,
    input.printType ?? null,
    input.source ?? null,
    input.costMinor ?? null,
    input.currency ?? null,
    input.acquiredOn ?? null,
    input.location ?? null,
    input.care ?? null,
    input.notes ?? null,
  ]
}

export class FabricRepository {
  constructor(private readonly database: Database) {}

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM fabric').get() as Row
    return Number(row.n)
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
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM fabric ${clause} ORDER BY updated_at DESC, name ASC`)
      .all(...parameters) as Row[]
    return rows.map(toFabric)
  }

  get(id: string): Fabric | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM fabric WHERE id = ?`).get(id) as Row | undefined
    return row ? toFabric(row) : null
  }

  #require(id: string): Fabric {
    const fabric = this.get(id)
    if (!fabric) throw new RecordNotFoundError(`No fabric with id ${id}.`)
    return fabric
  }

  create(input: FabricInput, nowIso: string): Fabric {
    const id = randomUUID()
    const statement = this.database.prepare(
      `INSERT INTO fabric (id, name, fibre, weight, length_mm, width_mm, original_length_mm,
        colour, print_type, source, cost_minor, currency, acquired_on, location, care, notes,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    statement.run(id, ...valuesOf(input), nowIso, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: FabricInput, nowIso: string): Fabric {
    this.#require(id)
    const statement = this.database.prepare(
      `UPDATE fabric SET name = ?, fibre = ?, weight = ?, length_mm = ?, width_mm = ?,
        original_length_mm = ?, colour = ?, print_type = ?, source = ?, cost_minor = ?,
        currency = ?, acquired_on = ?, location = ?, care = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    statement.run(...valuesOf(input), nowIso, id)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM fabric WHERE id = ?').run(id)
  }

  /** Full-text search across the indexed columns, prefix-matched, best first. */
  search(query: string, limit = 25): SearchHit[] {
    const matchQuery = buildMatchQuery(query)
    if (!matchQuery) return []
    const rows = this.database
      .prepare(
        `SELECT f.id AS id, f.name AS name, f.length_mm AS length_mm,
                snippet(fabric_fts, 5, '[', ']', ' … ', 10) AS snippet
           FROM fabric_fts
           JOIN fabric f ON f.rowid = fabric_fts.rowid
          WHERE fabric_fts MATCH ?
          ORDER BY bm25(fabric_fts), f.name ASC
          LIMIT ?`,
      )
      .all(matchQuery, limit) as Row[]
    return rows.map((row) => ({
      type: 'fabric' as const,
      id: String(row.id),
      title: String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: nullableNumber(row.length_mm),
    }))
  }
}

/**
 * Turn free text into a safe FTS5 MATCH expression: every word becomes a quoted
 * prefix term, joined with AND. Quoting means user punctuation can never be read
 * as FTS5 syntax, which would otherwise throw on a stray `"` or `*`.
 */
export function buildMatchQuery(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) return null
  return words.map((word) => `"${word}"*`).join(' AND ')
}

export function assertFabricInvariant(input: FabricInput): void {
  if (input.lengthMm !== null && input.lengthMm !== undefined && input.originalLengthMm) {
    if (input.lengthMm > input.originalLengthMm) {
      throw new RecordValidationError('Remaining length cannot exceed the original length.')
    }
  }
}
