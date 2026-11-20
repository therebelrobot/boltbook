import type { Fabric, ShortfallLine } from '../shared/model'
import { RecordValidationError } from './errors'

/**
 * Units on the wire.
 *
 * The database is canonical metric — integer millimetres, metres — and stays
 * that way. A caller may then ask for imperial: `?units=imperial` renames every
 * measure field to its unit-suffixed form and converts it, and writes accept
 * those same names back.
 *
 * The rename is the point. `lengthMm: 2.73` would be a lie; `lengthYd: 2.73` is
 * not, so a script can never misread a number because it forgot a query flag.
 * Metric is the default and is unchanged.
 */

export type Units = 'metric' | 'imperial'
export type MeasureKind = 'fabricLength' | 'fabricWidth' | 'threadLength'

export interface MeasureSpec {
  canonical: string
  imperial: string
  kind: MeasureKind
}

/** The fabric is the cloth: only its width is a measure on the fabric row. */
export const FABRIC_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'widthMm', imperial: 'widthIn', kind: 'fabricWidth' },
]

/** Lengths live on the cut: what is left, and what was bought. */
export const FABRIC_CUT_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'lengthMm', imperial: 'lengthYd', kind: 'fabricLength' },
  { canonical: 'originalLengthMm', imperial: 'originalLengthYd', kind: 'fabricLength' },
]

export const THREAD_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'lengthM', imperial: 'lengthYd', kind: 'threadLength' },
  { canonical: 'originalLengthM', imperial: 'originalLengthYd', kind: 'threadLength' },
]

export const REQUIREMENT_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'lengthMm', imperial: 'lengthYd', kind: 'fabricLength' },
  { canonical: 'fabricWidthMm', imperial: 'fabricWidthIn', kind: 'fabricWidth' },
]

export const FABRIC_ALLOCATION_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'lengthMmUsed', imperial: 'lengthYdUsed', kind: 'fabricLength' },
]

export const THREAD_ALLOCATION_MEASURES: readonly MeasureSpec[] = [
  { canonical: 'lengthMUsed', imperial: 'lengthYdUsed', kind: 'threadLength' },
]

const MM_PER_INCH = 25.4
const MM_PER_YARD = 914.4
const METRES_PER_YARD = 0.9144

const round2 = (value: number): number => Math.round(value * 100) / 100

const IMPERIAL_UNIT: Record<MeasureKind, string> = {
  fabricLength: 'yd',
  fabricWidth: 'in',
  threadLength: 'yd',
}

export function parseUnits(value: string | undefined): Units {
  if (value === undefined || value === '' || value === 'metric') return 'metric'
  if (value === 'imperial') return 'imperial'
  throw new RecordValidationError("units must be 'metric' or 'imperial'.")
}

export function toImperial(stored: number, kind: MeasureKind): number {
  if (kind === 'fabricWidth') return round2(stored / MM_PER_INCH)
  if (kind === 'threadLength') return round2(stored / METRES_PER_YARD)
  return round2(stored / MM_PER_YARD)
}

export function fromImperial(value: number, kind: MeasureKind): number {
  if (kind === 'fabricWidth') return Math.round(value * MM_PER_INCH)
  if (kind === 'threadLength') return Math.round(value * METRES_PER_YARD)
  return Math.round(value * MM_PER_YARD)
}

export function imperialUnitFor(kind: MeasureKind): string {
  return IMPERIAL_UNIT[kind]
}

type AnyRecord = Record<string, unknown>

/**
 * Accept imperial field names on the way in, converting them to the canonical
 * metric field the schema and the database expect. Supplying both names for the
 * same measure is refused rather than silently preferring one.
 */
export function normalizeMeasures(body: AnyRecord, specs: readonly MeasureSpec[]): AnyRecord {
  const result: AnyRecord = { ...body }
  for (const spec of specs) {
    const imperialValue = result[spec.imperial]
    if (imperialValue === undefined || imperialValue === null) continue
    const canonicalValue = result[spec.canonical]
    if (canonicalValue !== undefined && canonicalValue !== null) {
      throw new RecordValidationError(`Give either ${spec.canonical} or ${spec.imperial}, not both.`)
    }
    if (typeof imperialValue !== 'number' || !Number.isFinite(imperialValue)) {
      throw new RecordValidationError(`${spec.imperial} must be a number.`)
    }
    result[spec.canonical] = fromImperial(imperialValue, spec.kind)
    delete result[spec.imperial]
  }
  return result
}

/** Rename and convert measures for the response; metric passes straight through. */
export function presentMeasures<T extends object>(record: T, specs: readonly MeasureSpec[], units: Units): T {
  if (units === 'metric') return record
  const result = { ...record } as Record<string, unknown>
  for (const spec of specs) {
    if (!(spec.canonical in result)) continue
    const value = result[spec.canonical]
    result[spec.imperial] = typeof value === 'number' ? toImperial(value, spec.kind) : null
    delete result[spec.canonical]
  }
  return result as T
}

/** A fabric presents its width; its cuts present their lengths. */
export function presentFabric(fabric: Fabric, units: Units): Fabric {
  const widthOnly = presentMeasures(fabric, FABRIC_MEASURES, units)
  if (units === 'metric') return widthOnly
  return {
    ...widthOnly,
    cuts: fabric.cuts.map((cut) => presentMeasures(cut, FABRIC_CUT_MEASURES, units)),
  }
}

/** Shortfall lines carry their own unit, so the numbers never stand alone. */
export function presentShortfallLines(lines: readonly ShortfallLine[], units: Units): {
  units: Units
  lines: Array<Record<string, unknown>>
} {
  if (units === 'metric') {
    return { units, lines: lines.map((line) => ({ ...line })) }
  }
  return {
    units,
    lines: lines.map((line) => {
      const kind: MeasureKind = line.kind === 'fabric' ? 'fabricLength' : line.kind === 'thread' ? 'threadLength' : 'fabricLength'
      const label = line.kind === 'notion' ? null : imperialUnitFor(kind)
      const convert = (value: number | null): number | null => (value === null || line.kind === 'notion' ? value : toImperial(value, kind))
      return {
        ...line,
        needed: convert(line.needed),
        available: convert(line.available),
        short: convert(line.short),
        unit: label,
      }
    }),
  }
}
