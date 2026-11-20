/** Field descriptors, so every editor is one component rather than six near-copies. */

import type { UnitKind } from './units'

export type FieldKind = 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'tags'

export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  required?: boolean
  options?: readonly string[]
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
  help?: string
  /** A stored length: the editor shows and accepts it in the device's unit. */
  unitKind?: UnitKind
}

export const FABRIC_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Washed linen' },
  { name: 'fibre', label: 'Fibre', kind: 'text', placeholder: 'linen, cotton, wool…' },
  { name: 'weight', label: 'Weight', kind: 'text', placeholder: 'quilting, mid, canvas…' },
  { name: 'colour', label: 'Colour', kind: 'text' },
  { name: 'printType', label: 'Print', kind: 'text', placeholder: 'solid, stripe, check…' },
  { name: 'artist', label: 'Artist', kind: 'text', placeholder: 'who designed the print' },
  { name: 'repurchaseUrl', label: 'Repurchase link', kind: 'text', placeholder: 'https://…' },
  { name: 'widthMm', label: 'Width', kind: 'number', inputMode: 'numeric', unitKind: 'fabricWidth' },
  { name: 'location', label: 'Location', kind: 'text', placeholder: 'Bin A, shelf 2…' },
  { name: 'care', label: 'Care', kind: 'text' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

export const THREAD_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Mara 120' },
  { name: 'brand', label: 'Brand', kind: 'text', placeholder: 'Gütermann' },
  { name: 'colour', label: 'Colour', kind: 'text' },
  { name: 'colourCode', label: 'Colour code', kind: 'text' },
  { name: 'fibre', label: 'Fibre', kind: 'text', placeholder: 'polyester, cotton, silk…' },
  { name: 'weight', label: 'Weight', kind: 'text', placeholder: '120, 50wt…' },
  { name: 'spools', label: 'Spools', kind: 'number', inputMode: 'numeric' },
  { name: 'lengthM', label: 'Remaining', kind: 'number', inputMode: 'numeric', unitKind: 'threadLength' },
  { name: 'originalLengthM', label: 'Bought', kind: 'number', inputMode: 'numeric', unitKind: 'threadLength' },
  { name: 'needleSize', label: 'Needle', kind: 'text', placeholder: '80/12' },
  { name: 'location', label: 'Location', kind: 'text' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

export const NOTION_KINDS = ['button', 'zipper', 'interfacing', 'elastic', 'trim', 'other'] as const
export const NOTION_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Metal zip 20 cm' },
  { name: 'kind', label: 'Kind', kind: 'select', options: ['', ...NOTION_KINDS] },
  { name: 'colour', label: 'Colour', kind: 'text' },
  { name: 'spec', label: 'Spec', kind: 'text', placeholder: 'size, length, weight…' },
  { name: 'quantity', label: 'Quantity', kind: 'number', inputMode: 'decimal' },
  { name: 'unit', label: 'Unit', kind: 'text', placeholder: 'piece, m…' },
  { name: 'location', label: 'Location', kind: 'text' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

export const TOOL_CATEGORIES = ['cutting', 'measuring', 'pressing', 'machine', 'marking', 'needles_pins', 'other'] as const
export const TOOL_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Rotary cutter' },
  { name: 'category', label: 'Category', kind: 'select', options: ['', ...TOOL_CATEGORIES] },
  { name: 'brand', label: 'Brand', kind: 'text', placeholder: 'Olfa' },
  { name: 'spec', label: 'Spec', kind: 'text', placeholder: '45 mm' },
  { name: 'quantity', label: 'Quantity', kind: 'number', inputMode: 'numeric' },
  { name: 'location', label: 'Location', kind: 'text' },
  { name: 'needsAttention', label: 'Needs sharpening or replacing', kind: 'boolean' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

export const PATTERN_FORMATS = ['envelope', 'pdf', 'book', 'other'] as const
export const PATTERN_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Archer Button-Up' },
  { name: 'brand', label: 'Brand', kind: 'text', placeholder: 'Grainline' },
  { name: 'number', label: 'Number', kind: 'text' },
  { name: 'format', label: 'Format', kind: 'select', options: ['', ...PATTERN_FORMATS] },
  { name: 'category', label: 'Category', kind: 'text', placeholder: 'tops, bottoms, outerwear…' },
  { name: 'sizeMin', label: 'Size from', kind: 'text' },
  { name: 'sizeMax', label: 'Size to', kind: 'text' },
  { name: 'difficulty', label: 'Difficulty', kind: 'text' },
  { name: 'year', label: 'Year', kind: 'number', inputMode: 'numeric' },
  { name: 'triedAndTrue', label: 'Tried and true', kind: 'boolean' },
  { name: 'linkUrl', label: 'Link', kind: 'text', placeholder: 'https://…' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

export const PROJECT_STATUSES = ['planned', 'cutting', 'sewing', 'done', 'abandoned'] as const
export const PROJECT_FIELDS: readonly FieldSpec[] = [
  { name: 'title', label: 'Title', kind: 'text', required: true, placeholder: 'Archer shirt in linen' },
  { name: 'status', label: 'Status', kind: 'select', options: [...PROJECT_STATUSES] },
  { name: 'startedOn', label: 'Started', kind: 'text', placeholder: 'YYYY-MM-DD' },
  { name: 'finishedOn', label: 'Finished', kind: 'text', placeholder: 'YYYY-MM-DD' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
]

/** The four stash kinds share one list shape and one detail shape. */
export interface StashKindConfig {
  key: 'fabric' | 'thread' | 'notion' | 'tool'
  label: string
  path: string
  fields: readonly FieldSpec[]
  singular: string
}

export const STASH_KINDS: readonly StashKindConfig[] = [
  { key: 'fabric', label: 'Fabric', path: '/api/fabrics', fields: FABRIC_FIELDS, singular: 'Fabric' },
  { key: 'thread', label: 'Thread', path: '/api/threads', fields: THREAD_FIELDS, singular: 'Thread' },
  { key: 'notion', label: 'Notions', path: '/api/notions', fields: NOTION_FIELDS, singular: 'Notion' },
  { key: 'tool', label: 'Tools', path: '/api/tools', fields: TOOL_FIELDS, singular: 'Tool' },
]
