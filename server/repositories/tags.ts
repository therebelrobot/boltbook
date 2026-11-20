import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { TaggableType, Tag } from '../../shared/model'
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

/**
 * Tags: one vocabulary, shared across every kind of record.
 *
 * `tag` holds the names (unique case-insensitively) and `tag_link` the
 * many-to-many. A record's tags are sent and received as plain names — the
 * client never has to know an id to tag something.
 */
export class TagsRepository {
  constructor(private readonly database: Database) {}

  /** Every tag, most used first, so a picker can lead with the usual suspects. */
  listAll(): Tag[] {
    const rows = this.database
      .prepare(
        `SELECT t.id AS id, t.name AS name, COUNT(l.entity_id) AS usage_count
           FROM tag t LEFT JOIN tag_link l ON l.tag_id = t.id
          GROUP BY t.id, t.name
          ORDER BY usage_count DESC, t.name ASC`,
      )
      .all() as Row[]
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), usageCount: Number(row.usage_count) }))
  }

  create(name: string, nowIso: string): Tag {
    const trimmed = name.trim()
    const existing = this.database
      .prepare('SELECT id, name FROM tag WHERE name = ? COLLATE NOCASE')
      .get(trimmed) as Row | undefined
    if (existing) return { id: String(existing.id), name: String(existing.name), usageCount: this.#usage(String(existing.id)) }
    const id = randomUUID()
    this.database.prepare('INSERT INTO tag (id, name, created_at) VALUES (?, ?, ?)').run(id, trimmed, nowIso)
    return { id, name: trimmed, usageCount: 0 }
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM tag WHERE id = ?').run(id)
  }

  /**
   * Rename in place: the links move with the id, so every tagged record follows.
   * The vocabulary stays unique case-insensitively, so a name another tag
   * already holds — `linen` vs `Linen` — is a conflict, not a silent clobber.
   */
  rename(id: string, name: string): Tag {
    const trimmed = name.trim()
    if (trimmed === '') throw new RecordValidationError('A tag needs a name.')
    const row = this.database.prepare('SELECT id, name FROM tag WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No tag with id ${id}.`)
    const clash = this.database
      .prepare('SELECT id FROM tag WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(trimmed, id) as Row | undefined
    if (clash) throw new RecordConflictError(`A tag named "${trimmed}" already exists.`)
    if (trimmed === String(row.name)) return { id, name: String(row.name), usageCount: this.#usage(id) }
    this.database.prepare('UPDATE tag SET name = ? WHERE id = ?').run(trimmed, id)
    return { id, name: trimmed, usageCount: this.#usage(id) }
  }

  /**
   * Move every link onto another tag and remove the source. A record already
   * carrying the target ignores the duplicate rather than failing — a merge
   * that half-fails would be worse than a redundant link row, which cannot
   * exist anyway (the primary key sees to it).
   */
  merge(sourceId: string, targetId: string): Tag {
    if (sourceId === targetId) throw new RecordValidationError('A tag cannot be merged into itself.')
    const target = this.database.prepare('SELECT id, name FROM tag WHERE id = ?').get(targetId) as Row | undefined
    if (!target) throw new RecordNotFoundError(`No tag with id ${targetId}.`)
    const source = this.database.prepare('SELECT id FROM tag WHERE id = ?').get(sourceId) as Row | undefined
    if (!source) throw new RecordNotFoundError(`No tag with id ${sourceId}.`)
    this.database.exec('BEGIN')
    try {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO tag_link (tag_id, entity_type, entity_id)
             SELECT ?, entity_type, entity_id FROM tag_link WHERE tag_id = ?`,
        )
        .run(targetId, sourceId)
      this.database.prepare('DELETE FROM tag_link WHERE tag_id = ?').run(sourceId)
      this.database.prepare('DELETE FROM tag WHERE id = ?').run(sourceId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { id: String(target.id), name: String(target.name), usageCount: this.#usage(targetId) }
  }

  #usage(tagId: string): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM tag_link WHERE tag_id = ?').get(tagId) as Row
    return Number(row.n)
  }

  #resolveNames(names: readonly string[], nowIso: string): string[] {
    const ids: string[] = []
    for (const name of names) {
      const trimmed = name.trim()
      if (trimmed === '') continue
      ids.push(this.create(trimmed, nowIso).id)
    }
    return [...new Set(ids)]
  }

  /** Replace a record's tags wholesale. Creates any tag that does not exist yet. */
  setFor(entityType: TaggableType, entityId: string, names: readonly string[], nowIso: string): string[] {
    const tagIds = this.#resolveNames(names, nowIso)
    this.database.exec('BEGIN')
    try {
      this.database.prepare('DELETE FROM tag_link WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
      const insert = this.database.prepare('INSERT INTO tag_link (tag_id, entity_type, entity_id) VALUES (?, ?, ?)')
      for (const tagId of tagIds) insert.run(tagId, entityType, entityId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.namesFor(entityType, [entityId]).get(entityId) ?? []
  }

  /** Tag names per entity id, for a set of ids in one query. */
  namesFor(entityType: TaggableType, entityIds: readonly string[]): Map<string, string[]> {
    const byEntity = new Map<string, string[]>()
    for (const id of entityIds) byEntity.set(id, [])
    if (entityIds.length === 0) return byEntity
    const rows = this.database
      .prepare(
        `SELECT l.entity_id AS entity_id, t.name AS name
           FROM tag_link l JOIN tag t ON t.id = l.tag_id
          WHERE l.entity_type = ? AND l.entity_id IN (${placeholders(entityIds.length)})
          ORDER BY t.name ASC`,
      )
      .all(entityType, ...entityIds) as Row[]
    for (const row of rows) byEntity.get(String(row.entity_id))?.push(String(row.name))
    return byEntity
  }

  /** Entity ids carrying a tag, matched on the name case-insensitively. */
  idsWithTag(entityType: TaggableType, tagName: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT l.entity_id AS entity_id
           FROM tag_link l JOIN tag t ON t.id = l.tag_id
          WHERE l.entity_type = ? AND t.name = ? COLLATE NOCASE`,
      )
      .all(entityType, tagName) as Row[]
    return rows.map((row) => String(row.entity_id))
  }

  /**
   * Entities whose tags match any of the tokens, with the matched tag names.
   * Used to widen a text search: FTS covers the fields, this covers the labels.
   */
  searchByTag(entityType: TaggableType, tokens: readonly string[], limit: number): Array<{ entityId: string; names: string[] }> {
    if (tokens.length === 0) return []
    const conditions = tokens.map(() => 't.name LIKE ? COLLATE NOCASE').join(' OR ')
    const parameters: string[] = tokens.map((token) => `${token}%`)
    const rows = this.database
      .prepare(
        `SELECT l.entity_id AS entity_id, GROUP_CONCAT(t.name, ' ') AS names
           FROM tag_link l JOIN tag t ON t.id = l.tag_id
          WHERE l.entity_type = ? AND (${conditions})
          GROUP BY l.entity_id
          ORDER BY l.entity_id
          LIMIT ?`,
      )
      .all(entityType, ...parameters, limit) as Row[]
    return rows.map((row) => ({ entityId: String(row.entity_id), names: String(row.names).split(' ') }))
  }
}
