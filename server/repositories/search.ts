import type { Database } from '../database'
import type { SearchHit, TaggableType } from '../../shared/model'
import { TagsRepository } from './tags'

type Row = Record<string, unknown>

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

/**
 * Turn free text into a safe FTS5 MATCH expression: every word becomes a quoted
 * prefix term, joined with AND. Quoting means user punctuation can never be read
 * as FTS5 syntax, which would otherwise throw on a stray `"` or `*`.
 */
export function buildMatchQuery(query: string): string | null {
  const words = tokensOf(query)
  if (words.length === 0) return null
  return words.map((word) => `"${word}"*`).join(' AND ')
}

export function tokensOf(query: string): string[] {
  return query.match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Ranked search across every indexed entity, plus a pass over the tags.
 *
 * BM25 scores from different tables are not comparable, so results are grouped
 * by entity in a fixed order rather than interleaved: fabric, pattern, thread,
 * tool, notion, project. Projects come last on purpose — a project is about
 * what you did, not what you have, and ranking one beside a bolt would
 * surprise. A record whose *tag* matches is appended to its group — FTS covers
 * the fields, this covers the labels, and the snippet says which tag matched.
 */
export function searchAll(database: Database, query: string, limit = 25): SearchHit[] {
  const matchQuery = buildMatchQuery(query)
  const tokens = tokensOf(query)
  if (!matchQuery && tokens.length === 0) return []

  const queryTable = (sql: string): Row[] => (matchQuery ? (database.prepare(sql).all(matchQuery, limit) as Row[]) : [])

  const fabricRows = queryTable(
    `SELECT f.id AS id, f.name AS name, f.length_mm AS length_mm,
            snippet(fabric_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM fabric_fts JOIN fabric f ON f.rowid = fabric_fts.rowid
      WHERE fabric_fts MATCH ? ORDER BY bm25(fabric_fts), f.name ASC LIMIT ?`,
  )
  const patternRows = queryTable(
    `SELECT p.id AS id, p.name AS name,
            snippet(pattern_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM pattern_fts JOIN pattern p ON p.rowid = pattern_fts.rowid
      WHERE pattern_fts MATCH ? ORDER BY bm25(pattern_fts), p.name ASC LIMIT ?`,
  )
  const threadRows = queryTable(
    `SELECT t.id AS id, t.name AS name, t.colour AS colour,
            snippet(thread_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM thread_fts JOIN thread t ON t.rowid = thread_fts.rowid
      WHERE thread_fts MATCH ? ORDER BY bm25(thread_fts), t.name ASC LIMIT ?`,
  )
  const toolRows = queryTable(
    `SELECT o.id AS id, o.name AS name,
            snippet(tool_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM tool_fts JOIN tool o ON o.rowid = tool_fts.rowid
      WHERE tool_fts MATCH ? ORDER BY bm25(tool_fts), o.name ASC LIMIT ?`,
  )
  const notionRows = queryTable(
    `SELECT n.id AS id, n.name AS name, n.colour AS colour,
            snippet(notion_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM notion_fts JOIN notion n ON n.rowid = notion_fts.rowid
      WHERE notion_fts MATCH ? ORDER BY bm25(notion_fts), n.name ASC LIMIT ?`,
  )
  const projectRows = queryTable(
    `SELECT j.id AS id, j.title AS title,
            snippet(project_fts, -1, '[', ']', ' … ', 10) AS snippet
       FROM project_fts JOIN project j ON j.rowid = project_fts.rowid
      WHERE project_fts MATCH ? ORDER BY bm25(project_fts), j.title ASC LIMIT ?`,
  )

  const hits: SearchHit[] = [
    ...fabricRows.map((row) => ({
      type: 'fabric' as const,
      id: String(row.id),
      title: String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: row.length_mm === null || row.length_mm === undefined ? null : Number(row.length_mm),
    })),
    ...patternRows.map((row) => ({
      type: 'pattern' as const,
      id: String(row.id),
      title: String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: null,
    })),
    ...threadRows.map((row) => ({
      type: 'thread' as const,
      id: String(row.id),
      title: nullableText(row.colour) ? `${String(row.name)} — ${String(row.colour)}` : String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: null,
    })),
    ...toolRows.map((row) => ({
      type: 'tool' as const,
      id: String(row.id),
      title: String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: null,
    })),
    ...notionRows.map((row) => ({
      type: 'notion' as const,
      id: String(row.id),
      title: nullableText(row.colour) ? `${String(row.name)} — ${String(row.colour)}` : String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: null,
    })),
    // Projects last: what you did, after what you have.
    ...projectRows.map((row) => ({
      type: 'project' as const,
      id: String(row.id),
      title: String(row.title),
      snippet: nullableText(row.snippet),
      lengthMm: null,
    })),
  ]

  // Tag matches, appended to their group and de-duplicated against the FTS hits.
  if (tokens.length > 0) {
    const tags = new TagsRepository(database)
    const alreadySeen = new Set(hits.map((hit) => `${hit.type}:${hit.id}`))
    const addTagged = (
      entityType: TaggableType,
      loadRows: (ids: string[]) => Row[],
      type: SearchHit['type'],
      titleOf: (row: Row) => string,
    ): void => {
      const matches = tags.searchByTag(entityType, tokens, limit)
      if (matches.length === 0) return
      const rowsById = new Map(loadRows(matches.map((match) => match.entityId)).map((row) => [String(row.id), row]))
      for (const match of matches) {
        const key = `${type}:${match.entityId}`
        if (alreadySeen.has(key)) continue
        const row = rowsById.get(match.entityId)
        if (!row) continue
        alreadySeen.add(key)
        hits.push({
          type,
          id: match.entityId,
          title: titleOf(row),
          snippet: `tags: ${match.names.join(', ')}`,
          lengthMm: row.length_mm === null || row.length_mm === undefined ? null : Number(row.length_mm),
        })
      }
    }

    addTagged(
      'fabric',
      (ids) => database.prepare(`SELECT id, name, length_mm FROM fabric WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'fabric',
      (row) => String(row.name),
    )
    addTagged(
      'pattern',
      (ids) => database.prepare(`SELECT id, name FROM pattern WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'pattern',
      (row) => String(row.name),
    )
    addTagged(
      'thread',
      (ids) => database.prepare(`SELECT id, name, colour FROM thread WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'thread',
      (row) => (nullableText(row.colour) ? `${String(row.name)} — ${String(row.colour)}` : String(row.name)),
    )
    addTagged(
      'tool',
      (ids) => database.prepare(`SELECT id, name FROM tool WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'tool',
      (row) => String(row.name),
    )
    addTagged(
      'notion',
      (ids) => database.prepare(`SELECT id, name, colour FROM notion WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'notion',
      (row) => (nullableText(row.colour) ? `${String(row.name)} — ${String(row.colour)}` : String(row.name)),
    )
    addTagged(
      'project',
      (ids) => database.prepare(`SELECT id, title FROM project WHERE id IN (${placeholders(ids.length)})`).all(...ids) as Row[],
      'project',
      (row) => String(row.title),
    )
  }

  return hits
}
