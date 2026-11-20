import type { Database } from './database'

/**
 * Costing: presentation over data that already exists. `cost_minor` carries its
 * own currency per row, so a total across mixed currencies is meaningless —
 * totals are **per currency**, stated as such, and no exchange rate is ever
 * invented or fetched. Nothing leaves the box to compute any of this.
 */

export interface CostLine {
  kind: 'fabric' | 'thread'
  targetId: string
  name: string
  costMinor: number
  currency: string
}

export interface CurrencyTotal {
  currency: string
  minor: number
}

export interface ProjectCost {
  title: string
  /** The allocated records that carry a cost. A notion has no cost to give. */
  lines: CostLine[]
  /** Per currency — never one number across currencies. */
  totals: CurrencyTotal[]
}

type Row = Record<string, unknown>

const totalsOf = (rows: Array<{ currency: unknown; costMinor: unknown }>): CurrencyTotal[] => {
  const byCurrency = new Map<string, number>()
  for (const row of rows) {
    if (row.costMinor === null || row.costMinor === undefined) continue
    const currency = String(row.currency ?? '')
    if (!currency) continue
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + Number(row.costMinor))
  }
  return [...byCurrency.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/** What a project's allocations cost, summed from the records' own `cost_minor`. */
export function projectCost(database: Database, projectId: string): ProjectCost | null {
  const project = database.prepare('SELECT title FROM project WHERE id = ?').get(projectId) as Row | undefined
  if (!project) return null

  const fabricRows = database
    .prepare(
      `SELECT f.id AS target_id, f.name AS name, f.cost_minor AS cost, f.currency AS currency
         FROM project_fabric a JOIN fabric f ON f.id = a.fabric_id
        WHERE a.project_id = ? ORDER BY f.name ASC`,
    )
    .all(projectId) as Row[]
  const threadRows = database
    .prepare(
      `SELECT t.id AS target_id, t.name AS name, t.cost_minor AS cost, t.currency AS currency
         FROM project_thread a JOIN thread t ON t.id = a.thread_id
        WHERE a.project_id = ? ORDER BY t.name ASC`,
    )
    .all(projectId) as Row[]

  const toLine = (kind: 'fabric' | 'thread') => (row: Row): CostLine | null => {
    if (row.cost === null || row.cost === undefined) return null
    return {
      kind,
      targetId: String(row.target_id),
      name: String(row.name),
      costMinor: Number(row.cost),
      // A cost with no currency is shown but cannot join a total — a number
      // without a unit is not money.
      currency: String(row.currency ?? ''),
    }
  }
  const lines = [
    ...fabricRows.map(toLine('fabric')),
    ...threadRows.map(toLine('thread')),
  ].filter((line): line is CostLine => line !== null)

  return { title: String(project.title), lines, totals: totalsOf(lines) }
}

/** What the whole stash is worth — fabric, thread and tools. Per currency. */
export function stashValue(database: Database): CurrencyTotal[] {
  const rows = [
    ...(database.prepare('SELECT cost_minor, currency FROM fabric').all() as Row[]),
    ...(database.prepare('SELECT cost_minor, currency FROM thread').all() as Row[]),
    ...(database.prepare('SELECT cost_minor, currency FROM tool').all() as Row[]),
  ].map((row) => ({ costMinor: row.cost_minor, currency: row.currency }))
  return totalsOf(rows)
}
