import { useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from './Sheet'
import { TagsField } from './TagsField'
import { useUnit } from '../unitPreference'
import { unitLabel } from '../units'
import { coerceField, displayField, type FormValue } from '../formValues'
import type { FieldSpec } from '../fields'

interface EntitySheetProps {
  title: string
  fields: readonly FieldSpec[]
  /** null creates; a record edits. */
  record: Record<string, unknown> | null
  onSave: (values: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  /** Above the fields: what you provide first. The photo of a fabric leads. */
  leading?: ReactNode
  /** Below the fields: detail that follows the identity, e.g. views, allocation. */
  children?: ReactNode
}

export function EntitySheet({ title, fields, record, onSave, onDelete, onClose, leading, children }: EntitySheetProps) {
  const { unit } = useUnit()
  const [values, setValues] = useState<Record<string, FormValue>>(() => {
    const initial: Record<string, FormValue> = {}
    for (const spec of fields) initial[spec.name] = displayField(spec, record, unit)
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
      payload[spec.name] = coerceField(spec, value, record, unit)
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
        {leading}

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
