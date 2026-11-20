import { z } from 'zod'

/**
 * Absent and null both mean "not recorded", so every optional field normalises
 * to `null` on the way out — which is what the database stores and what the
 * shared model declares. `.nullish()` keeps it optional on the wire.
 */
const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => (value === undefined ? null : value))

const optionalText = (max: number) => nullable(z.string().trim().max(max))
const optionalMillimetres = nullable(z.number().int().min(0).max(1_000_000))
const optionalMetres = nullable(z.number().int().min(0).max(1_000_000))
const optionalCost = nullable(z.number().int().min(0).max(1_000_000_000))
const optionalCurrency = nullable(z.string().trim().length(3))
const optionalDate = nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'))

/** Tags are sent as names; the store creates any that do not exist yet. */
const tagList = z.array(z.string().trim().min(1).max(60)).max(30).default([])

export const fabricInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  fibre: optionalText(120),
  weight: optionalText(120),
  widthMm: optionalMillimetres,
  colour: optionalText(120),
  printType: optionalText(120),
  source: optionalText(200),
  location: optionalText(200),
  care: optionalText(500),
  notes: nullable(z.string().max(5000)),
  artist: optionalText(200),
  // Rendered as a link, so `javascript:` must be refused before it is stored,
  // not filtered at the click. http(s) only.
  repurchaseUrl: nullable(z.string().trim().max(1000)).refine(
    (value) => value === null || /^https?:\/\//i.test(value),
    'A repurchase link must be an http(s) URL.',
  ),
  tags: tagList,
})

/** The cut is the piece: its own lengths, price and acquisition date. */
export const fabricCutInputSchema = z.object({
  lengthMm: optionalMillimetres,
  originalLengthMm: optionalMillimetres,
  costMinor: optionalCost,
  currency: optionalCurrency,
  acquiredOn: optionalDate,
})

export const patternInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: optionalText(120),
  number: optionalText(60),
  format: nullable(z.enum(['envelope', 'pdf', 'book', 'other'])),
  sizeMin: optionalText(40),
  sizeMax: optionalText(40),
  difficulty: optionalText(60),
  category: optionalText(80),
  source: optionalText(200),
  year: nullable(z.number().int().min(1800).max(2200)),
  triedAndTrue: z.boolean().default(false),
  linkUrl: nullable(z.string().trim().max(1000)),
  notes: nullable(z.string().max(5000)),
  tags: tagList,
})

export const patternViewInputSchema = z.object({
  label: z.string().trim().min(1).max(40),
  description: optionalText(500),
})

export const patternRequirementInputSchema = z.object({
  role: z.enum(['main', 'lining', 'interfacing', 'other']),
  lengthMm: nullable(z.number().int().min(0).max(1_000_000)),
  fabricWidthMm: nullable(z.number().int().min(0).max(100_000)),
  note: optionalText(300),
})

export const notionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: nullable(z.enum(['button', 'zipper', 'interfacing', 'elastic', 'trim', 'other'])),
  colour: optionalText(120),
  spec: optionalText(120),
  quantity: nullable(z.number().min(0).max(1_000_000)),
  unit: optionalText(40),
  location: optionalText(200),
  notes: nullable(z.string().max(5000)),
  tags: tagList,
})

export const threadInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: optionalText(120),
  colour: optionalText(120),
  colourCode: optionalText(60),
  fibre: optionalText(60),
  weight: optionalText(60),
  spools: nullable(z.number().int().min(0).max(10_000)),
  lengthM: optionalMetres,
  originalLengthM: optionalMetres,
  needleSize: optionalText(60),
  location: optionalText(200),
  source: optionalText(200),
  costMinor: optionalCost,
  currency: optionalCurrency,
  acquiredOn: optionalDate,
  notes: nullable(z.string().max(5000)),
  tags: tagList,
})

export const toolInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: nullable(z.enum(['cutting', 'measuring', 'pressing', 'machine', 'marking', 'needles_pins', 'other'])),
  brand: optionalText(120),
  spec: optionalText(200),
  quantity: nullable(z.number().int().min(0).max(10_000)),
  location: optionalText(200),
  needsAttention: z.boolean().default(false),
  acquiredOn: optionalDate,
  costMinor: optionalCost,
  currency: optionalCurrency,
  notes: nullable(z.string().max(5000)),
  tags: tagList,
})

export const projectInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  patternViewId: nullable(z.string().trim().min(1).max(64)),
  status: z.enum(['planned', 'cutting', 'sewing', 'done', 'abandoned']).default('planned'),
  startedOn: optionalDate,
  finishedOn: optionalDate,
  notes: nullable(z.string().max(5000)),
  tags: tagList,
})

export const allocationsInputSchema = z.object({
  fabrics: z
    .array(z.object({ cutId: z.string().trim().min(1).max(64), lengthMmUsed: optionalMillimetres }))
    .default([]),
  threads: z
    .array(z.object({ threadId: z.string().trim().min(1).max(64), lengthMUsed: optionalMetres }))
    .default([]),
  notions: z
    .array(z.object({ notionId: z.string().trim().min(1).max(64), quantityUsed: nullable(z.number().min(0).max(1_000_000)) }))
    .default([]),
})

export const setupRequestSchema = z.object({
  setupToken: z.string().trim().min(1).max(200),
  passphrase: z.string().min(1).max(1000),
})

export const loginRequestSchema = z.object({
  passphrase: z.string().min(1).max(1000),
  totpCode: z.string().trim().max(20).optional(),
})

export const passphraseChangeRequestSchema = z.object({
  currentPassphrase: z.string().min(1).max(1000),
  newPassphrase: z.string().min(1).max(1000),
})

export const passphraseConfirmationSchema = z.object({
  passphrase: z.string().min(1).max(1000),
})

export const totpConfirmRequestSchema = z.object({
  code: z.string().trim().min(1).max(20),
})

export const tagInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
})

export const tagRenameSchema = z.object({
  name: z.string().trim().min(1).max(60),
})

export const tagMergeSchema = z.object({
  /** The tag the links move onto. */
  into: z.string().trim().min(1).max(64),
})
