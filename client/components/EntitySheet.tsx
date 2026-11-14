import { useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from './Sheet'
import { TagsField } from './TagsField'
import { useUnit } from '../unitPreference'
import { fromStored, toStored, unitLabel } from '../units'
import type { FieldSpec } from '../fields'

interface EntitySheetProps {
  title: string
  fields: readonly FieldSpec[]
  /** null creates; a record edits. */
  record: Record<string, unknown> | null
  onSave: (values: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  /** Extra sections below the fields, e.g. a fabric's photos. */
  children?: ReactNode
}

type FormValue = string | boolean | string[]

/** Length fields show the device's unit, so a stored 2500 mm reads as 2.73 yd. */
function displayValue(spec: FieldSpec, record: Record<string, unknown> | null, unit: 'metric' | 'imperial'): FormValue {
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
 * Coerce the form's strings back to what the API expects. A length the user did
 * not touch is sent back exactly as stored, so opening an editor and saving can
 * never quietly move 2500 mm to 2497.
 */
function coerce(spec: FieldSpec, value: FormValue, record: Record<string, unknown> | null, unit: 'metric' | 'imperial'): unknown {
  if (spec.kind === 'boolean') return value === true
  if (spec.kind === 'tags') {
    return Array.isArray(value) ? value.map((tag) => tag.trim()).filter((tag) => tag !== '') : []
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (spec.unitKind) {
    const stored = record?.[spec.name]
    if (typeof stored === 'number' && String(fromStored(stored, spec.unitKind, unit)) === value) return stored
    return toStored(parsed, spec.unitKind, unit)
  }
  return spec.kind === 'number' ? parsed : value.trim()
}

export function EntitySheet({ title, fields, record, onSave, onDelete, onClose, children }: EntitySheetProps) {
  const { unit } = useUnit()
  const [values, setValues] = useState<Record<string, FormValue>>(() => {
    const initial: Record<string, FormValue> = {}
    for (const spec of fields) initial[spec.name] = displayValue(spec, record, unit)
    return initial
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)

    const payload: Record<string, unknown> = {}
    for (const spec of fields) {
      const fallback: FormValue = spec.kind === 'boolean' ? false : spec.kind === 'tags' ? [] : ''
      const value = values[spec.name] ?? fallback
      if (spec.required && (typeof value !== 'string' || value.trim() === '')) {
        setError(`${spec.label} is needed.`)
        return
      }
      payload[spec.name] = coerce(spec, value, record, unit)
    }

    setBusy(true)
    try {
      await onSave(payload)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!onDelete) return
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {fields.map((spec) => {
          const value = values[spec.name]
          const id = `field-${spec.name}`
          const label = spec.unitKind ? `${spec.label} (${unitLabel(spec.unitKind, unit)})` : spec.label

          if (spec.kind === 'boolean') {
            return (
              <label className="field checkbox" key={spec.name} htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => setValues((current) => ({ ...current, [spec.name]: event.target.checked }))}
                />
                <span>{label}</span>
              </label>
            )
          }
          if (spec.kind === 'tags') {
            return (
              <TagsField
                key={spec.name}
                value={Array.isArray(value) ? value : []}
                onChange={(tags) => setValues((current) => ({ ...current, [spec.name]: tags }))}
              />
            )
          }
          return (
            <label className="field" key={spec.name} htmlFor={id}>
              <span className="label">
                {label}
                {spec.required ? '' : ' (optional)'}
              </span>
              {spec.kind === 'textarea' ? (
                <textarea
                  id={id}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={spec.placeholder}
                  onChange={(event) => setValues((current) => ({ ...current, [spec.name]: event.target.value }))}
                />
              ) : spec.kind === 'select' ? (
                <select
                  id={id}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(event) => setValues((current) => ({ ...current, [spec.name]: event.target.value }))}
                >
                  {(spec.options ?? []).map((option) => (
                    <option key={option || 'none'} value={option}>
                      {option === '' ? '—' : option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type="text"
                  inputMode={spec.inputMode ?? 'text'}
                  autoCapitalize={spec.kind === 'number' ? 'none' : undefined}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={spec.placeholder}
                  onChange={(event) => setValues((current) => ({ ...current, [spec.name]: event.target.value }))}
                />
              )}
            </label>
          )
        })}

        {error && <p className="error">{error}</p>}
        {children}

        <div className="actions">
          <button type="submit" className="button primary" disabled={busy}>
            {record ? 'Save' : 'Add'}
          </button>
          {onDelete && (
            <button type="button" className="button danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
