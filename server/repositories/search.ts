import type { Database } from '../database'
import type { SearchHit } from '../../shared/model'

type Row = Record<string, unknown>

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

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

/**
 * Ranked search across every indexed entity. BM25 scores from different tables
 * are not comparable, so results are grouped by entity in a fixed order rather
 * than interleaved: fabric, pattern, thread, tool.
 */
export function searchAll(database: Database, query: string, limit = 25): SearchHit[] {
  const matchQuery = buildMatchQuery(query)
  if (!matchQuery) return []

  const queryTable = (sql: string): Row[] => database.prepare(sql).all(matchQuery, limit) as Row[]

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

  return [
    ...fabricRows.map((row) => ({
      type: 'fabric' as const,
      id: String(row.id),
      title: String(row.name),
      snippet: nullableText(row.snippet),
      lengthMm: nullableNumber(row.length_mm),
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
  ]
}
