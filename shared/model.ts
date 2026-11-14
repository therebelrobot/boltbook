/**
 * The wire contract: what the API sends and the client reads. Field names are
 * camelCase here and snake_case in the database; the repository maps between.
 */

export interface Fabric {
  id: string
  name: string
  fibre: string | null
  weight: string | null
  colour: string | null
  printType: string | null
  widthMm: number | null
  lengthMm: number | null
  originalLengthMm: number | null
  source: string | null
  costMinor: number | null
  currency: string | null
  acquiredOn: string | null
  location: string | null
  care: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Everything a caller may set. `id` and timestamps are the server's. */
export type FabricInput = Omit<Fabric, 'id' | 'createdAt' | 'updatedAt'>

export interface FabricFilters {
  fibre?: string
  location?: string
  /** Only fabrics whose remaining length is at least this many millimetres. */
  minLengthMm?: number
}

export interface SearchHit {
  type: 'fabric'
  id: string
  title: string
  snippet: string | null
  lengthMm: number | null
}

export interface Status {
  ok: true
  fabricCount: number
}
