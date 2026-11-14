/**
 * The wire contract: what the API sends and the client reads. Field names are
 * camelCase here and snake_case in the database; the repositories map between.
 */

export type PatternFormat = 'envelope' | 'pdf' | 'book' | 'other'
export type RequirementRole = 'main' | 'lining' | 'interfacing' | 'other'
export type NotionKind = 'button' | 'zipper' | 'interfacing' | 'elastic' | 'trim' | 'other'
export type ToolCategory = 'cutting' | 'measuring' | 'pressing' | 'machine' | 'marking' | 'needles_pins' | 'other'

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

export interface PatternRequirement {
  id: string
  patternViewId: string
  role: RequirementRole
  fabricWidthMm: number | null
  lengthMm: number | null
  note: string | null
}

export type PatternRequirementInput = Omit<PatternRequirement, 'id' | 'patternViewId'>

export interface PatternView {
  id: string
  patternId: string
  label: string
  description: string | null
  position: number
  requirements: PatternRequirement[]
}

export interface PatternViewInput {
  label: string
  description: string | null
}

export interface Pattern {
  id: string
  name: string
  brand: string | null
  number: string | null
  format: PatternFormat | null
  sizeMin: string | null
  sizeMax: string | null
  difficulty: string | null
  category: string | null
  source: string | null
  year: number | null
  triedAndTrue: boolean
  linkUrl: string | null
  notes: string | null
  views: PatternView[]
  createdAt: string
  updatedAt: string
}

/** Pattern without its views; the caller may set these, the server owns the rest. */
export interface PatternInput {
  name: string
  brand: string | null
  number: string | null
  format: PatternFormat | null
  sizeMin: string | null
  sizeMax: string | null
  difficulty: string | null
  category: string | null
  source: string | null
  year: number | null
  triedAndTrue: boolean
  linkUrl: string | null
  notes: string | null
}

export interface PatternFilters {
  brand?: string
  category?: string
  format?: PatternFormat
  triedAndTrue?: boolean
}

export interface Notion {
  id: string
  name: string
  kind: NotionKind | null
  colour: string | null
  spec: string | null
  quantity: number | null
  unit: string | null
  location: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type NotionInput = Omit<Notion, 'id' | 'createdAt' | 'updatedAt'>

export interface NotionFilters {
  kind?: NotionKind
  location?: string
}

/** Thread is its own thing: brand/line, colour code, fibre, weight, spools, metres left. */
export interface Thread {
  id: string
  name: string
  brand: string | null
  colour: string | null
  colourCode: string | null
  fibre: string | null
  weight: string | null
  spools: number | null
  lengthM: number | null
  originalLengthM: number | null
  needleSize: string | null
  location: string | null
  source: string | null
  costMinor: number | null
  currency: string | null
  acquiredOn: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type ThreadInput = Omit<Thread, 'id' | 'createdAt' | 'updatedAt'>

export interface ThreadFilters {
  colour?: string
  fibre?: string
  location?: string
}

export interface Tool {
  id: string
  name: string
  category: ToolCategory | null
  brand: string | null
  spec: string | null
  quantity: number | null
  location: string | null
  needsAttention: boolean
  acquiredOn: string | null
  costMinor: number | null
  currency: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type ToolInput = Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>

export interface ToolFilters {
  category?: ToolCategory
  location?: string
  needsAttention?: boolean
}

export interface SearchHit {
  type: 'fabric' | 'pattern' | 'thread' | 'tool'
  id: string
  title: string
  snippet: string | null
  /** Fabric remaining length in millimetres; null for every other hit type. */
  lengthMm: number | null
}

export interface Status {
  ok: true
  fabricCount: number
  patternCount: number
  notionCount: number
  threadCount: number
  toolCount: number
}
