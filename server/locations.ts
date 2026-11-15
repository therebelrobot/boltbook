import type { Database } from './database'
import type { LocationSummary } from '../shared/model'

type Row = Record<string, unknown>

/**
 * Storage locations are a free-text field on every record, not a table — the
 * app deliberately does not make you create a bin before you can put something
 * in it. The label sheet and the location screen need the distinct values and
 * how much is in each, so this is the one read that assembles them.
 *
 * Case is folded: `Bin A` and `bin a` are one location, and the name shown is
 * the case-insensitively smallest spelling, so the ordering is stable.
 */
export function listLocations(database: Database): LocationSummary[] {
  const rows = database
    .prepare(
      `SELECT MIN(name) AS name,
              SUM(fabric_count) AS fabric_count,
              SUM(thread_count) AS thread_count,
              SUM(tool_count) AS tool_count,
              SUM(notion_count) AS notion_count,
              SUM(fabric_count + thread_count + tool_count + notion_count) AS total
         FROM (
           SELECT location AS name, 1 AS fabric_count, 0 AS thread_count, 0 AS tool_count, 0 AS notion_count
             FROM fabric WHERE location IS NOT NULL AND TRIM(location) <> ''
           UNION ALL
           SELECT location, 0, 1, 0, 0
             FROM thread WHERE location IS NOT NULL AND TRIM(location) <> ''
           UNION ALL
           SELECT location, 0, 0, 1, 0
             FROM tool WHERE location IS NOT NULL AND TRIM(location) <> ''
           UNION ALL
           SELECT location, 0, 0, 0, 1
             FROM notion WHERE location IS NOT NULL AND TRIM(location) <> ''
         )
        GROUP BY name COLLATE NOCASE
        ORDER BY name COLLATE NOCASE ASC`,
    )
    .all() as Row[]

  return rows.map((row) => ({
    name: String(row.name),
    fabricCount: Number(row.fabric_count),
    threadCount: Number(row.thread_count),
    toolCount: Number(row.tool_count),
    notionCount: Number(row.notion_count),
    total: Number(row.total),
  }))
}
