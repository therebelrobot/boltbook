import { randomUUID } from 'node:crypto'
import type { Database } from '../database'
import type { Fabric, FabricCut, FabricCutInput, FabricFilters, FabricInput } from '../../shared/model'
import { TagsRepository } from './tags'
import { PhotoRepository } from './photos'
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from '../errors'

type Row = Record<string, unknown>

const COLUMNS = `id, name, fibre, weight, width_mm, colour, print_type, source,
  location, care, notes, artist, repurchase_url, created_at, updated_at`

const CUT_COLUMNS = `id, fabric_id, position, length_mm, original_length_mm, cost_minor,
  currency, acquired_on, created_at, updated_at`

const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

function toCut(row: Row): FabricCut {
  return {
    id: String(row.id),
    fabricId: String(row.fabric_id),
    position: Number(row.position),
    lengthMm: nullableNumber(row.length_mm),
    originalLengthMm: nullableNumber(row.original_length_mm),
    costMinor: nullableNumber(row.cost_minor),
    currency: nullableText(row.currency),
    acquiredOn: nullableText(row.acquired_on),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function toFabric(row: Row, cuts: FabricCut[], photos: Fabric['photos'], tags: string[]): Fabric {
  return {
    id: String(row.id),
    name: String(row.name),
    fibre: nullableText(row.fibre),
    weight: nullableText(row.weight),
    widthMm: nullableNumber(row.width_mm),
    colour: nullableText(row.colour),
    printType: nullableText(row.print_type),
    source: nullableText(row.source),
    location: nullableText(row.location),
    care: nullableText(row.care),
    artist: nullableText(row.artist),
    repurchaseUrl: nullableText(row.repurchase_url),
    notes: nullableText(row.notes),
    cuts,
    photos,
    tags,
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
    input.widthMm,
    input.colour,
    input.printType,
    input.source,
    input.location,
    input.care,
    input.notes,
    input.artist,
    input.repurchaseUrl,
  ]
}

const cutValuesOf = (input: FabricCutInput): Array<string | number | null> => [
  input.lengthMm,
  input.originalLengthMm,
  input.costMinor,
  input.currency,
  input.acquiredOn,
]

export class FabricRepository {
  private readonly tags: TagsRepository
  private readonly photos: PhotoRepository

  constructor(private readonly database: Database) {
    this.tags = new TagsRepository(database)
    this.photos = new PhotoRepository(database)
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS n FROM fabric').get() as Row
    return Number(row.n)
  }

  #cutsFor(fabricIds: string[]): Map<string, FabricCut[]> {
    const byFabric = new Map<string, FabricCut[]>()
    for (const id of fabricIds) byFabric.set(id, [])
    if (fabricIds.length === 0) return byFabric
    const rows = this.database
      .prepare(
        `SELECT ${CUT_COLUMNS} FROM fabric_cut WHERE fabric_id IN (${placeholders(fabricIds.length)})
          ORDER BY position ASC, created_at ASC`,
      )
      .all(...fabricIds) as Row[]
    for (const row of rows) {
      byFabric.get(String(row.fabric_id))?.push(toCut(row))
    }
    return byFabric
  }

  /** The fabric's remaining length is the sum of its cuts — the one truth, derived. */
  #remainingExpr = `(SELECT COALESCE(SUM(length_mm), 0) FROM fabric_cut WHERE fabric_id = fabric.id)`

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
      where.push(`${this.#remainingExpr} >= ?`)
      parameters.push(filters.minLengthMm)
    }
    if (filters.tag) {
      where.push(
        `id IN (SELECT l.entity_id FROM tag_link l JOIN tag t ON t.id = l.tag_id
                 WHERE l.entity_type = 'fabric' AND t.name = ? COLLATE NOCASE)`,
      )
      parameters.push(filters.tag)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM fabric ${clause} ORDER BY updated_at DESC, name ASC`)
      .all(...parameters) as Row[]
    const ids = rows.map((row) => String(row.id))
    const cuts = this.#cutsFor(ids)
    const photos = this.photos.listFor('fabric', ids)
    const tags = this.tags.namesFor('fabric', ids)
    return rows.map((row) =>
      toFabric(row, cuts.get(String(row.id)) ?? [], photos.get(String(row.id)) ?? [], tags.get(String(row.id)) ?? []),
    )
  }

  get(id: string): Fabric | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM fabric WHERE id = ?`).get(id) as Row | undefined
    if (!row) return null
    return toFabric(
      row,
      this.#cutsFor([id]).get(id) ?? [],
      this.photos.listFor('fabric', [id]).get(id) ?? [],
      this.tags.namesFor('fabric', [id]).get(id) ?? [],
    )
  }

  #require(id: string): Fabric {
    const fabric = this.get(id)
    if (!fabric) throw new RecordNotFoundError(`No fabric with id ${id}.`)
    return fabric
  }

  /**
   * A new fabric starts with one empty cut: a fabric holds one or more cuts,
   * and the lengths live there — a camera-first record can still be a photo
   * and a name, with the piece measured later.
   */
  create(input: FabricInput, nowIso: string): Fabric {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO fabric (id, name, fibre, weight, width_mm, colour, print_type, source,
          location, care, notes, artist, repurchase_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ...valuesOf(input), nowIso, nowIso)
    this.database
      .prepare(
        `INSERT INTO fabric_cut (id, fabric_id, position, length_mm, original_length_mm,
          cost_minor, currency, acquired_on, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), id, null, null, null, null, null, nowIso, nowIso)
    this.tags.setFor('fabric', id, input.tags, nowIso)
    return this.#require(id)
  }

  replace(id: string, input: FabricInput, nowIso: string): Fabric {
    this.#require(id)
    this.database
      .prepare(
        `UPDATE fabric SET name = ?, fibre = ?, weight = ?, width_mm = ?, colour = ?,
          print_type = ?, source = ?, location = ?, care = ?, notes = ?, artist = ?,
          repurchase_url = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(...valuesOf(input), nowIso, id)
    this.tags.setFor('fabric', id, input.tags, nowIso)
    return this.#require(id)
  }

  delete(id: string): void {
    this.#require(id)
    // No foreign key reaches the shared photo table, so the cascade is a step;
    // the cuts go with the fabric through their own foreign key.
    this.photos.deleteAllFor('fabric', id)
    this.database.prepare('DELETE FROM fabric WHERE id = ?').run(id)
  }

  // ---------- cuts ----------

  addCut(fabricId: string, input: FabricCutInput, nowIso: string): FabricCut {
    this.#require(fabricId)
    assertCutInvariant(input)
    const nextPosition = this.database
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM fabric_cut WHERE fabric_id = ?')
      .get(fabricId) as Row
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO fabric_cut (id, fabric_id, position, length_mm, original_length_mm,
          cost_minor, currency, acquired_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, fabricId, Number(nextPosition.next), ...cutValuesOf(input), nowIso, nowIso)
    this.database.prepare('UPDATE fabric SET updated_at = ? WHERE id = ?').run(nowIso, fabricId)
    return this.#cut(fabricId, id)
  }

  replaceCut(fabricId: string, cutId: string, input: FabricCutInput, nowIso: string): FabricCut {
    this.#require(fabricId)
    const cut = this.#cut(fabricId, cutId)
    assertCutInvariant(input)
    this.database
      .prepare(
        `UPDATE fabric_cut SET length_mm = ?, original_length_mm = ?, cost_minor = ?,
          currency = ?, acquired_on = ?, updated_at = ? WHERE id = ?`,
      )
      .run(...cutValuesOf(input), nowIso, cut.id)
    this.database.prepare('UPDATE fabric SET updated_at = ? WHERE id = ?').run(nowIso, fabricId)
    return this.#cut(fabricId, cutId)
  }

  deleteCut(fabricId: string, cutId: string, nowIso: string): void {
    this.#require(fabricId)
    const cut = this.#cut(fabricId, cutId)
    const countRow = this.database
      .prepare('SELECT COUNT(*) AS n FROM fabric_cut WHERE fabric_id = ?')
      .get(fabricId) as Row
    if (Number(countRow.n) <= 1) {
      throw new RecordConflictError('A fabric keeps at least one cut. Delete the fabric instead.')
    }
    // What the project reserved against this cut goes with it; the allocation
    // is the cut, and the cut is gone.
    this.database.prepare('DELETE FROM project_cut WHERE cut_id = ?').run(cut.id)
    this.database.prepare('DELETE FROM fabric_cut WHERE id = ?').run(cut.id)
    this.database.prepare('UPDATE fabric SET updated_at = ? WHERE id = ?').run(nowIso, fabricId)
  }

  /** A cut belongs to exactly one fabric, and cannot move. */
  #cut(fabricId: string, cutId: string): FabricCut {
    const row = this.database
      .prepare(`SELECT ${CUT_COLUMNS} FROM fabric_cut WHERE id = ? AND fabric_id = ?`)
      .get(cutId, fabricId) as Row | undefined
    if (!row) throw new RecordNotFoundError(`No cut ${cutId} on fabric ${fabricId}.`)
    return toCut(row)
  }

  /** The cut a project allocation points at, for the shortfall arithmetic. */
  cutById(cutId: string): FabricCut | null {
    const row = this.database.prepare(`SELECT ${CUT_COLUMNS} FROM fabric_cut WHERE id = ?`).get(cutId) as Row | undefined
    return row ? toCut(row) : null
  }

  /** The fabric a cut belongs to — name, width and provenance for the shortfall readout. */
  fabricOfCut(cutId: string): { id: string; name: string; colour: string | null; source: string | null; widthMm: number | null; cutCount: number; cutPosition: number } | null {
    const row = this.database
      .prepare(
        `SELECT f.id AS id, f.name AS name, f.colour AS colour, f.source AS source, f.width_mm AS width_mm,
                (SELECT COUNT(*) FROM fabric_cut WHERE fabric_id = f.id) AS cut_count,
                (SELECT position FROM fabric_cut WHERE id = ?) AS cut_position
           FROM fabric f JOIN fabric_cut c ON c.fabric_id = f.id WHERE c.id = ?`,
      )
      .get(cutId, cutId) as Row | undefined
    if (!row) return null
    return {
      id: String(row.id),
      name: String(row.name),
      colour: nullableText(row.colour),
      source: nullableText(row.source),
      widthMm: nullableNumber(row.width_mm),
      cutCount: Number(row.cut_count),
      cutPosition: Number(row.cut_position),
    }
  }

  /** Sums for a set of fabrics in one query — the meter, the row, the search hit. */
  remainingByFabric(fabricIds: readonly string[]): Map<string, number | null> {
    const byId = new Map<string, number | null>()
    for (const id of fabricIds) byId.set(id, null)
    if (fabricIds.length === 0) return byId
    const rows = this.database
      .prepare(
        `SELECT fabric_id, SUM(length_mm) AS remaining FROM fabric_cut
          WHERE fabric_id IN (${placeholders(fabricIds.length)}) GROUP BY fabric_id`,
      )
      .all(...fabricIds) as Row[]
    for (const row of rows) byId.set(String(row.fabric_id), nullableNumber(row.remaining))
    return byId
  }
}

export function assertCutInvariant(input: FabricCutInput): void {
  if (input.lengthMm !== null && input.originalLengthMm !== null && input.lengthMm > input.originalLengthMm) {
    throw new RecordValidationError('Remaining length cannot exceed the original length.')
  }
}
