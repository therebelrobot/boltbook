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

export const fabricInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  fibre: optionalText(120),
  weight: optionalText(120),
  lengthMm: optionalMillimetres,
  widthMm: optionalMillimetres,
  originalLengthMm: optionalMillimetres,
  colour: optionalText(120),
  printType: optionalText(120),
  source: optionalText(200),
  costMinor: nullable(z.number().int().min(0).max(1_000_000_000)),
  currency: nullable(z.string().trim().length(3)),
  acquiredOn: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  location: optionalText(200),
  care: optionalText(500),
  notes: nullable(z.string().max(5000)),
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
  kind: nullable(z.enum(['thread', 'button', 'zipper', 'interfacing', 'elastic', 'trim', 'other'])),
  colour: optionalText(120),
  spec: optionalText(120),
  quantity: nullable(z.number().min(0).max(1_000_000)),
  unit: optionalText(40),
  location: optionalText(200),
  notes: nullable(z.string().max(5000)),
})
