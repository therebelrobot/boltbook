import type { Database } from '../database'
import type { SearchHit } from '../../shared/model'

type Row = Record<string, unknown>

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

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
 * Ranked search across every indexed entity. Fabric hits carry the remaining
 * length; pattern hits carry the match snippet. Fabrics come first, then
 * patterns — BM25 scores from two tables are not comparable, so they are not
 * interleaved.
 */
export function searchAll(database: Database, query: string, limit = 25): SearchHit[] {
  const matchQuery = buildMatchQuery(query)
  if (!matchQuery) return []

  const fabricRows = database
    .prepare(
      `SELECT f.id AS id, f.name AS name, f.length_mm AS length_mm,
              snippet(fabric_fts, -1, '[', ']', ' … ', 10) AS snippet
         FROM fabric_fts
         JOIN fabric f ON f.rowid = fabric_fts.rowid
        WHERE fabric_fts MATCH ?
        ORDER BY bm25(fabric_fts), f.name ASC
        LIMIT ?`,
    )
    .all(matchQuery, limit) as Row[]

  const patternRows = database
    .prepare(
      `SELECT p.id AS id, p.name AS name,
              snippet(pattern_fts, -1, '[', ']', ' … ', 10) AS snippet
         FROM pattern_fts
         JOIN pattern p ON p.rowid = pattern_fts.rowid
        WHERE pattern_fts MATCH ?
        ORDER BY bm25(pattern_fts), p.name ASC
        LIMIT ?`,
    )
    .all(matchQuery, limit) as Row[]

  return [
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
  ]
}
