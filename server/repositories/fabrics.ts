import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Fabric, FabricFilters, FabricInput } from '../../shared/model'
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
    this.database
      .prepare(
        `INSERT INTO fabric (id, name, fibre, weight, length_mm, width_mm, original_length_mm,
          colour, print_type, source, cost_minor, currency, acquired_on, location, care, notes,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
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
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM fabric WHERE id = ?').run(id)
  }
}

export function assertFabricInvariant(input: FabricInput): void {
  if (input.lengthMm !== null && input.originalLengthMm !== null && input.lengthMm > input.originalLengthMm) {
    throw new RecordValidationError('Remaining length cannot exceed the original length.')
  }
}
