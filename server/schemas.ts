import { z } from 'zod'

/**
 * Absent and null both mean "not recorded", so every optional field normalises
 * to `null` on the way out — which is what the database stores and what
 * `FabricInput` declares. `.nullish()` keeps it optional on the wire.
 */
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value ?? null)
const optionalMillimetres = z
  .number()
  .int()
  .min(0)
  .max(1_000_000)
  .nullish()
  .transform((value) => value ?? null)

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
  costMinor: z.number().int().min(0).max(1_000_000_000).nullish().transform((value) => value ?? null),
  currency: z.string().trim().length(3).nullish().transform((value) => value ?? null),
  acquiredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullish()
    .transform((value) => value ?? null),
  location: optionalText(200),
  care: optionalText(500),
  notes: z.string().max(5000).nullish().transform((value) => value ?? null),
})

export type FabricInputDTO = z.infer<typeof fabricInputSchema>
