/**
 * Units.
 *
 * The database and API are canonical metric — integer millimetres for fabric,
 * metres for thread — so nothing is ever stored lossily. Display and input are
 * the client's business: a device preference picks metric or imperial, and the
 * editors convert on the way in and out.
 *
 * Imperial reads the way a sewer buys: fabric in yards, thread in yards, and
 * fabric width in inches (44", 58") because that is how it is sold.
 */

export type LengthUnit = 'metric' | 'imperial'
export type UnitKind = 'fabricLength' | 'fabricWidth' | 'threadLength'

export const MM_PER_INCH = 25.4
export const MM_PER_YARD = 914.4
export const METRES_PER_YARD = 0.9144

const round2 = (value: number): number => Math.round(value * 100) / 100

/** Trailing zeros dropped: 2.50 → 2.5, 44.00 → 44. */
const pretty = (value: number): string => {
  const fixed = value.toFixed(2)
  return fixed.replace(/\.?0+$/, '')
}

export function unitLabel(kind: UnitKind, unit: LengthUnit): string {
  if (unit === 'metric') return kind === 'threadLength' ? 'm' : 'mm'
  return kind === 'fabricWidth' ? 'in' : 'yd'
}

/** Stored value → the number the user sees, in their unit. */
export function fromStored(stored: number | null | undefined, kind: UnitKind, unit: LengthUnit): number | null {
  if (stored === null || stored === undefined) return null
  if (unit === 'metric') return stored
  if (kind === 'fabricWidth') return round2(stored / MM_PER_INCH)
  if (kind === 'threadLength') return round2(stored / METRES_PER_YARD)
  return round2(stored / MM_PER_YARD)
}

/** The number the user typed → the canonical stored value. */
export function toStored(value: number | null | undefined, kind: UnitKind, unit: LengthUnit): number | null {
  if (value === null || value === undefined) return null
  if (unit === 'metric') return Math.round(value)
  if (kind === 'fabricWidth') return Math.round(value * MM_PER_INCH)
  if (kind === 'threadLength') return Math.round(value * METRES_PER_YARD)
  return Math.round(value * MM_PER_YARD)
}

/** Stored value → the string shown in a list row or a readout. */
export function formatStored(stored: number | null | undefined, kind: UnitKind, unit: LengthUnit): string {
  if (stored === null || stored === undefined) return '—'
  if (unit === 'metric') {
    if (kind === 'threadLength') return `${stored} m`
    if (kind === 'fabricLength' && stored >= 1000) return `${(stored / 1000).toFixed(2)} m`
    return `${stored} mm`
  }
  const converted = fromStored(stored, kind, unit)
  if (converted === null) return '—'
  return `${pretty(converted)} ${unitLabel(kind, unit)}`
}
