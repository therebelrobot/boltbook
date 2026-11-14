import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Tool, ToolCategory, ToolFilters, ToolInput } from '../../shared/model'
import { RecordNotFoundError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, category, brand, spec, quantity, location, needs_attention,
  acquired_on, cost_minor, currency, notes, created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function toTool(row: Row): Tool {
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
  constructor(private readonly database: Database) {}

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
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM tool ${clause} ORDER BY category ASC, name ASC`)
      .all(...parameters) as Row[]
    return rows.map(toTool)
  }

  get(id: string): Tool | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM tool WHERE id = ?`).get(id) as Row | undefined
    return row ? toTool(row) : null
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
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM tool WHERE id = ?').run(id)
  }
}
