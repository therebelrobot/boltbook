import type { FieldSpec } from './fields'
import { fromStored, toStored, type LengthUnit } from './units'

/**
 * Form value ↔ record value, kept out of the component so it can be tested.
 *
 * This is where a real bug lived: a `Number(value)` check added for the unit
 * fields ran for *every* field, so a text field like a fabric's name coerced to
 * `null` and every create failed validation. The rules are small and worth
 * asserting on their own.
 */

export type FormValue = string | boolean | string[]

/** The record's value as the form shows it, in the device's unit. */
export function displayField(spec: FieldSpec, record: Record<string, unknown> | null, unit: LengthUnit): FormValue {
  const raw = record?.[spec.name]
  if (spec.kind === 'boolean') return raw === true
  if (spec.kind === 'tags') return Array.isArray(raw) ? raw.map(String) : []
  if (raw === null || raw === undefined) return ''
  if (spec.unitKind && typeof raw === 'number') {
    const shown = fromStored(raw, spec.unitKind, unit)
    return shown === null ? '' : String(shown)
  }
  return String(raw)
}

/**
 * The form's value as the API wants it. A length the user did not touch is sent
 * back exactly as stored, so opening an editor and saving can never quietly move
 * 2500 mm to 2496.
 */
export function coerceField(
  spec: FieldSpec,
  value: FormValue,
  record: Record<string, unknown> | null,
  unit: LengthUnit,
): unknown {
  if (spec.kind === 'boolean') return value === true
  if (spec.kind === 'tags') {
    return Array.isArray(value) ? value.map((tag) => tag.trim()).filter((tag) => tag !== '') : []
  }

  // Absent means "not recorded" for every other kind.
  if (typeof value !== 'string' || value.trim() === '') return null

  if (spec.kind === 'number') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    if (!spec.unitKind) return parsed

    const stored = record?.[spec.name]
    if (typeof stored === 'number' && String(fromStored(stored, spec.unitKind, unit)) === value) return stored
    return toStored(parsed, spec.unitKind, unit)
  }

  // Text stays text.
  return value.trim()
}
