import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import { computeShortfalls, keyOf, type AllocationClaim } from '../shortfall'
import type {
  FabricAllocation,
  NotionAllocation,
  Project,
  ProjectAllocations,
  ProjectFilters,
  ProjectInput,
  ProjectStatus,
  ShortfallLine,
  ThreadAllocation,
} from '../../shared/model'
import { RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const PROJECT_COLUMNS = `id, title, pattern_view_id, status, consumed, started_on, finished_on,
  notes, created_at, updated_at`

const ACTIVE = `'planned', 'cutting', 'sewing'`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

function toProject(row: Row, allocations: ProjectAllocations): Project {
  return {
    id: String(row.id),
    title: String(row.title),
    patternViewId: nullableText(row.pattern_view_id),
    status: String(row.status) as ProjectStatus,
    consumed: Number(row.consumed) === 1,
    startedOn: nullableText(row.started_on),
    finishedOn: nullableText(row.finished_on),
    notes: nullableText(row.notes),
    allocations,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const emptyAllocations = (): ProjectAllocations => ({ fabrics: [], threads: [], notions: [] })

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM project').get() as Row
    return Number(row.n)
  }

  #allocationsFor(projectIds: string[]): Map<string, ProjectAllocations> {
    const byProject = new Map<string, ProjectAllocations>()
    for (const id of projectIds) byProject.set(id, emptyAllocations())
    if (projectIds.length === 0) return byProject

    const clause = `WHERE project_id IN (${placeholders(projectIds.length)})`
    const fabricRows = this.database.prepare(`SELECT * FROM project_fabric ${clause}`).all(...projectIds) as Row[]
    const threadRows = this.database.prepare(`SELECT * FROM project_thread ${clause}`).all(...projectIds) as Row[]
    const notionRows = this.database.prepare(`SELECT * FROM project_notion ${clause}`).all(...projectIds) as Row[]

    for (const row of fabricRows) {
      byProject.get(String(row.project_id))?.fabrics.push({
        fabricId: String(row.fabric_id),
        lengthMmUsed: nullableNumber(row.length_mm_used),
      })
    }
    for (const row of threadRows) {
      byProject.get(String(row.project_id))?.threads.push({
        threadId: String(row.thread_id),
        lengthMUsed: nullableNumber(row.length_m_used),
      })
    }
    for (const row of notionRows) {
      byProject.get(String(row.project_id))?.notions.push({
        notionId: String(row.notion_id),
        quantityUsed: nullableNumber(row.quantity_used),
      })
    }
    return byProject
  }

  list(filters: ProjectFilters = {}): Project[] {
    const where: string[] = []
    const parameters: Array<string | number> = []
    if (filters.status) {
      where.push('status = ?')
      parameters.push(filters.status)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM project ${clause} ORDER BY updated_at DESC, title ASC`)
      .all(...parameters) as Row[]
    const allocations = this.#allocationsFor(rows.map((row) => String(row.id)))
    return rows.map((row) => toProject(row, allocations.get(String(row.id)) ?? emptyAllocations()))
  }

  get(id: string): Project | null {
    const row = this.database.prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toProject(row, this.#allocationsFor([id]).get(id) ?? emptyAllocations())
  }

  #require(id: string): Project {
    const project = this.get(id)
    if (!project) throw new RecordNotFoundError(`No project with id ${id}.`)
    return project
  }

  create(input: ProjectInput, nowIso: string): Project {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO project (id, title, pattern_view_id, status, consumed, started_on, finished_on,
          notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.title, input.patternViewId, input.status, input.startedOn, input.finishedOn, input.notes, nowIso, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: ProjectInput, nowIso: string): Project {
    const existing = this.#require(id)
    this.database
      .prepare(
        `UPDATE project SET title = ?, pattern_view_id = ?, status = ?, started_on = ?, finished_on = ?,
          notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(input.title, input.patternViewId, input.status, input.startedOn, input.finishedOn, input.notes, nowIso, id)

    // Reaching done consumes what was allocated, once.
    if (input.status === 'done' && existing.status !== 'done' && !existing.consumed) {
      this.#consume(id, nowIso)
    }
    // Moving off done un-consumes nothing: the cloth is already cut.
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    this.database.prepare('DELETE FROM project WHERE id = ?').run(id)
  }

  setAllocations(id: string, allocations: ProjectAllocations, nowIso: string): Project {
    this.#require(id)
    for (const allocation of allocations.fabrics) this.#assertExists('fabric', allocation.fabricId)
    for (const allocation of allocations.threads) this.#assertExists('thread', allocation.threadId)
    for (const allocation of allocations.notions) this.#assertExists('notion', allocation.notionId)

    this.database.exec('BEGIN')
    try {
      this.database.prepare('DELETE FROM project_fabric WHERE project_id = ?').run(id)
      this.database.prepare('DELETE FROM project_thread WHERE project_id = ?').run(id)
      this.database.prepare('DELETE FROM project_notion WHERE project_id = ?').run(id)
      const insertFabric = this.database.prepare(
        'INSERT INTO project_fabric (project_id, fabric_id, length_mm_used) VALUES (?, ?, ?)',
      )
      for (const allocation of allocations.fabrics) insertFabric.run(id, allocation.fabricId, allocation.lengthMmUsed)
      const insertThread = this.database.prepare(
        'INSERT INTO project_thread (project_id, thread_id, length_m_used) VALUES (?, ?, ?)',
      )
      for (const allocation of allocations.threads) insertThread.run(id, allocation.threadId, allocation.lengthMUsed)
      const insertNotion = this.database.prepare(
        'INSERT INTO project_notion (project_id, notion_id, quantity_used) VALUES (?, ?, ?)',
      )
      for (const allocation of allocations.notions) insertNotion.run(id, allocation.notionId, allocation.quantityUsed)
      this.database.prepare('UPDATE project SET updated_at = ? WHERE id = ?').run(nowIso, id)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.#require(id)
  }

  #assertExists(kind: 'fabric' | 'thread' | 'notion', targetId: string): void {
    const row = this.database.prepare(`SELECT 1 AS present FROM ${kind} WHERE id = ?`).get(targetId) as Row | undefined
    if (!row) throw new RecordValidationError(`No ${kind} with id ${targetId}.`)
  }

  #consume(projectId: string, nowIso: string): void {
    const fabricRows = this.database
      .prepare('SELECT fabric_id, length_mm_used FROM project_fabric WHERE project_id = ?')
      .all(projectId) as Row[]
    const decrementFabric = this.database.prepare(
      'UPDATE fabric SET length_mm = MAX(0, COALESCE(length_mm, 0) - ?) WHERE id = ?',
    )
    for (const row of fabricRows) {
      if (row.length_mm_used !== null && row.length_mm_used !== undefined) {
        decrementFabric.run(Number(row.length_mm_used), String(row.fabric_id))
      }
    }

    const threadRows = this.database
      .prepare('SELECT thread_id, length_m_used FROM project_thread WHERE project_id = ?')
      .all(projectId) as Row[]
    const decrementThread = this.database.prepare(
      'UPDATE thread SET length_m = MAX(0, COALESCE(length_m, 0) - ?) WHERE id = ?',
    )
    for (const row of threadRows) {
      if (row.length_m_used !== null && row.length_m_used !== undefined) {
        decrementThread.run(Number(row.length_m_used), String(row.thread_id))
      }
    }

    const notionRows = this.database
      .prepare('SELECT notion_id, quantity_used FROM project_notion WHERE project_id = ?')
      .all(projectId) as Row[]
    const decrementNotion = this.database.prepare(
      'UPDATE notion SET quantity = MAX(0, COALESCE(quantity, 0) - ?) WHERE id = ?',
    )
    for (const row of notionRows) {
      if (row.quantity_used !== null && row.quantity_used !== undefined) {
        decrementNotion.run(Number(row.quantity_used), String(row.notion_id))
      }
    }

    this.database.prepare('UPDATE project SET consumed = 1, updated_at = ? WHERE id = ?').run(nowIso, projectId)
  }

  /** What other active projects have reserved, per `${kind}:${id}`. */
  #reserved(excludeProjectId: string): Record<string, number> {
    const reserved: Record<string, number> = {}
    const queries = [
      ['fabric', 'project_fabric', 'fabric_id', 'length_mm_used'],
      ['thread', 'project_thread', 'thread_id', 'length_m_used'],
      ['notion', 'project_notion', 'notion_id', 'quantity_used'],
    ] as const
    for (const [kind, table, idColumn, amountColumn] of queries) {
      const rows = this.database
        .prepare(
          `SELECT a.${idColumn} AS id, COALESCE(SUM(a.${amountColumn}), 0) AS n
             FROM ${table} a JOIN project p ON p.id = a.project_id
            WHERE p.status IN (${ACTIVE}) AND p.id <> ?
            GROUP BY a.${idColumn}`,
        )
        .all(excludeProjectId) as Row[]
      for (const row of rows) reserved[keyOf(kind, String(row.id))] = Number(row.n)
    }
    return reserved
  }

  shortfall(projectId: string): ShortfallLine[] {
    const project = this.#require(projectId)
    const claims: AllocationClaim[] = [
      ...project.allocations.fabrics.map((a) => ({ kind: 'fabric' as const, targetId: a.fabricId, amount: a.lengthMmUsed })),
      ...project.allocations.threads.map((a) => ({ kind: 'thread' as const, targetId: a.threadId, amount: a.lengthMUsed })),
      ...project.allocations.notions.map((a) => ({ kind: 'notion' as const, targetId: a.notionId, amount: a.quantityUsed })),
    ]
    if (claims.length === 0) return []

    const remaining: Record<string, number | null> = {}
    const widthMm: Record<string, number | null> = {}

    const fabricIds = project.allocations.fabrics.map((a) => a.fabricId)
    if (fabricIds.length > 0) {
      const rows = this.database
        .prepare(`SELECT id, length_mm, width_mm FROM fabric WHERE id IN (${placeholders(fabricIds.length)})`)
        .all(...fabricIds) as Row[]
      for (const row of rows) {
        remaining[keyOf('fabric', String(row.id))] = nullableNumber(row.length_mm)
        widthMm[keyOf('fabric', String(row.id))] = nullableNumber(row.width_mm)
      }
    }

    const threadIds = project.allocations.threads.map((a) => a.threadId)
    if (threadIds.length > 0) {
      const rows = this.database
        .prepare(`SELECT id, length_m FROM thread WHERE id IN (${placeholders(threadIds.length)})`)
        .all(...threadIds) as Row[]
      for (const row of rows) remaining[keyOf('thread', String(row.id))] = nullableNumber(row.length_m)
    }

    const notionIds = project.allocations.notions.map((a) => a.notionId)
    if (notionIds.length > 0) {
      const rows = this.database
        .prepare(`SELECT id, quantity FROM notion WHERE id IN (${placeholders(notionIds.length)})`)
        .all(...notionIds) as Row[]
      for (const row of rows) remaining[keyOf('notion', String(row.id))] = nullableNumber(row.quantity)
    }

    return computeShortfalls(claims, {
      remaining,
      reserved: this.#reserved(projectId),
      widthMm,
      requiredWidthMm: this.#requiredFabricWidth(project.patternViewId),
    })
  }

  /** The view's fabric width requirement, main role first. */
  #requiredFabricWidth(viewId: string | null): number | null {
    if (!viewId) return null
    const row = this.database
      .prepare(
        `SELECT fabric_width_mm FROM pattern_requirement
          WHERE pattern_view_id = ? AND fabric_width_mm IS NOT NULL
          ORDER BY CASE role WHEN 'main' THEN 0 ELSE 1 END, rowid ASC LIMIT 1`,
      )
      .get(viewId) as Row | undefined
    return row ? nullableNumber(row.fabric_width_mm) : null
  }
}

export type { FabricAllocation, ThreadAllocation, NotionAllocation }
