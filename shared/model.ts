/**
 * The wire contract: what the API sends and the client reads. Field names are
 * camelCase here and snake_case in the database; the repositories map between.
 */

export type PatternFormat = 'envelope' | 'pdf' | 'book' | 'other'
export type RequirementRole = 'main' | 'lining' | 'interfacing' | 'other'
export type NotionKind = 'button' | 'zipper' | 'interfacing' | 'elastic' | 'trim' | 'other'
export type ToolCategory = 'cutting' | 'measuring' | 'pressing' | 'machine' | 'marking' | 'needles_pins' | 'other'

/** Everything that can carry tags. */
export type TaggableType = 'fabric' | 'pattern' | 'thread' | 'tool' | 'notion' | 'project'

export interface Tag {
  id: string
  name: string
  usageCount: number
}

/**
 * A photo on any record. The bytes are served by id; the metadata is what a
 * list carries. `entityType` is the taggable set — the same six kinds of record.
 */
export interface Photo {
  id: string
  entityType: TaggableType
  entityId: string
  position: number
  contentType: string
  widthPx: number | null
  heightPx: number | null
  byteSize: number
  createdAt: string
}

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
  photos: Photo[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** Everything a caller may set. `id`, `photos` and timestamps are the server's. */
export type FabricInput = Omit<Fabric, 'id' | 'photos' | 'createdAt' | 'updatedAt'>

export interface FabricFilters {
  fibre?: string
  location?: string
  /** Only fabrics whose remaining length is at least this many millimetres. */
  minLengthMm?: number
  tag?: string
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

/** The first page of an owned pattern PDF, rendered by the client on upload. */
export interface PatternFileThumbnail {
  contentType: string
  widthPx: number | null
  heightPx: number | null
}

/** The PDF a pattern owns. Metadata only; the bytes are served by id. */
export interface PatternFile {
  id: string
  patternId: string
  filename: string
  contentType: string
  pageCount: number | null
  byteSize: number
  thumbnail: PatternFileThumbnail | null
  createdAt: string
  updatedAt: string
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
  file: PatternFile | null
  photos: Photo[]
  tags: string[]
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
  tags: string[]
}

export interface PatternFilters {
  brand?: string
  category?: string
  format?: PatternFormat
  triedAndTrue?: boolean
  tag?: string
}

/** A storage location, derived from the free-text `location` on every record. */
export interface LocationSummary {
  name: string
  fabricCount: number
  threadCount: number
  toolCount: number
  notionCount: number
  total: number
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
  photos: Photo[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type NotionInput = Omit<Notion, 'id' | 'photos' | 'createdAt' | 'updatedAt'>

export interface NotionFilters {
  kind?: NotionKind
  location?: string
  tag?: string
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
  photos: Photo[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type ThreadInput = Omit<Thread, 'id' | 'photos' | 'createdAt' | 'updatedAt'>

export interface ThreadFilters {
  colour?: string
  fibre?: string
  location?: string
  tag?: string
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
  photos: Photo[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type ToolInput = Omit<Tool, 'id' | 'photos' | 'createdAt' | 'updatedAt'>

export interface ToolFilters {
  category?: ToolCategory
  location?: string
  needsAttention?: boolean
  tag?: string
}

// ---------- projects and allocation ----------

export type ProjectStatus = 'planned' | 'cutting' | 'sewing' | 'done' | 'abandoned'

/** Statuses during which a project reserves stash it has not consumed yet. */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['planned', 'cutting', 'sewing']

export interface FabricAllocation {
  fabricId: string
  lengthMmUsed: number | null
}

export interface ThreadAllocation {
  threadId: string
  lengthMUsed: number | null
}

export interface NotionAllocation {
  notionId: string
  quantityUsed: number | null
}

export interface ProjectAllocations {
  fabrics: FabricAllocation[]
  threads: ThreadAllocation[]
  notions: NotionAllocation[]
}

export interface Project {
  id: string
  title: string
  patternViewId: string | null
  status: ProjectStatus
  /** True once the stash has been decremented for this project. */
  consumed: boolean
  startedOn: string | null
  finishedOn: string | null
  notes: string | null
  allocations: ProjectAllocations
  photos: Photo[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type ProjectInput = Omit<Project, 'id' | 'allocations' | 'consumed' | 'photos' | 'createdAt' | 'updatedAt'>

export interface ProjectFilters {
  status?: ProjectStatus
  tag?: string
}

export type ConsumableKind = 'fabric' | 'thread' | 'notion'

export interface ShortfallLine {
  kind: ConsumableKind
  targetId: string
  needed: number | null
  /** Remaining in the stash minus what other active projects have reserved. */
  available: number
  /** Positive when the stash cannot cover the claim; 0 when it can. */
  short: number
  /** Fabric narrower than the pattern asks for. A warning, not a shortfall. */
  tooNarrow: boolean
}

/** One line of a project's shopping list: what to buy, and how much. */
export interface ShoppingListItem {
  kind: ConsumableKind
  targetId: string
  name: string
  /** The record's own second field, so the line identifies the thing: a thread's colour, a notion's spec. */
  detail: string | null
  /** The stored `source` — where it came from. Notions have none. */
  source: string | null
  /** How much to buy, in the claim's own unit: millimetres of fabric, metres of thread, or a count. */
  amount: number
  /** 'mm' | 'm' | the notion's stored unit — or an imperial label when asked for. */
  unit: string | null
}

export interface SearchHit {
  type: 'fabric' | 'pattern' | 'thread' | 'tool' | 'notion' | 'project'
  id: string
  title: string
  snippet: string | null
  /** Fabric remaining length in millimetres; null for every other hit type. */
  lengthMm: number | null
}

export interface AuthStatus {
  /** True once the instance has been claimed (an account exists). */
  claimed: boolean
  signedIn: boolean
  totpEnabled: boolean
  sessionIdleMinutes: number
}

export interface Status {
  ok: true
  fabricCount: number
  patternCount: number
  notionCount: number
  threadCount: number
  toolCount: number
  projectCount: number
  /** What the stash is worth — fabric, thread and tools, one total per currency. */
  stashValue: Array<{ currency: string; minor: number }>
}
