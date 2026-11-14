import { useState } from 'react'
import { api } from '../api'
import { useUnit } from '../unitPreference'
import { fromStored, toStored, unitLabel } from '../units'
import type { Pattern, PatternRequirement, PatternView, RequirementRole } from '../../shared/model'

const ROLES: readonly RequirementRole[] = ['main', 'lining', 'interfacing', 'other']

/** A number typed into a length field, or null — never NaN sent to the API. */
const parsedNumber = (value: string): number | null => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const shownLength = (millimetres: number | null, unit: 'metric' | 'imperial'): string =>
  millimetres === null ? '' : String(fromStored(millimetres, 'fabricLength', unit))

const shownWidth = (millimetres: number | null, unit: 'metric' | 'imperial'): string =>
  millimetres === null ? '' : String(fromStored(millimetres, 'fabricWidth', unit))

/** One requirement: role, how much cloth, how wide. Saves when a field loses focus. */
function RequirementRow({
  patternId,
  viewId,
  requirement,
  onChanged,
}: {
  patternId: string
  viewId: string
  requirement: PatternRequirement
  onChanged: () => void
}) {
  const { unit } = useUnit()
  const [role, setRole] = useState<RequirementRole>(requirement.role)
  const [length, setLength] = useState(() => shownLength(requirement.lengthMm, unit))
  const [width, setWidth] = useState(() => shownWidth(requirement.fabricWidthMm, unit))
  const [note, setNote] = useState(requirement.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async (overrides: Partial<{ role: RequirementRole; length: string; width: string; note: string }> = {}): Promise<void> => {
    const nextRole = overrides.role ?? role
    const nextLength = overrides.length ?? length
    const nextWidth = overrides.width ?? width
    const nextNote = overrides.note ?? note

    const lengthMm = nextLength.trim() === '' ? null : toStored(parsedNumber(nextLength), 'fabricLength', unit)
    const fabricWidthMm = nextWidth.trim() === '' ? null : toStored(parsedNumber(nextWidth), 'fabricWidth', unit)
    const trimmedNote = nextNote.trim() === '' ? null : nextNote.trim()

    // Nothing moved: do not write, so a blur cannot silently re-round a length.
    if (
      lengthMm === requirement.lengthMm &&
      fabricWidthMm === requirement.fabricWidthMm &&
      nextRole === requirement.role &&
      trimmedNote === requirement.note
    ) {
      return
    }

    setError(null)
    try {
      await api(`/api/patterns/${patternId}/views/${viewId}/requirements/${requirement.id}`, {
        method: 'PUT',
        body: { role: nextRole, lengthMm, fabricWidthMm, note: trimmedNote },
      })
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the requirement.')
    }
  }

  const remove = async (): Promise<void> => {
    await api(`/api/patterns/${patternId}/views/${viewId}/requirements/${requirement.id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
      <label className="field" htmlFor={`role-${requirement.id}`}>
        <span className="label">Role</span>
        <select
          id={`role-${requirement.id}`}
          value={role}
          onChange={(event) => {
            const next = event.target.value as RequirementRole
            setRole(next)
            void save({ role: next })
          }}
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`length-${requirement.id}`}>
        <span className="label">Needs ({unitLabel('fabricLength', unit)})</span>
        <input
          id={`length-${requirement.id}`}
          inputMode="numeric"
          value={length}
          onChange={(event) => setLength(event.target.value)}
          onBlur={() => void save()}
        />
      </label>
      <label className="field" htmlFor={`width-${requirement.id}`}>
        <span className="label">Fabric width ({unitLabel('fabricWidth', unit)})</span>
        <input
          id={`width-${requirement.id}`}
          inputMode="numeric"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
          onBlur={() => void save()}
        />
      </label>
      <label className="field" htmlFor={`note-${requirement.id}`}>
        <span className="label">Note (optional)</span>
        <input
          id={`note-${requirement.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void save()}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="button" className="button plain" onClick={() => void remove()}>
        Remove requirement
      </button>
    </div>
  )
}

/** One view: its label, its description, and the cloth each role needs. */
function ViewBlock({
  patternId,
  view,
  onChanged,
}: {
  patternId: string
  view: PatternView
  onChanged: () => void
}) {
  const { unit } = useUnit()
  const [label, setLabel] = useState(view.label)
  const [description, setDescription] = useState(view.description ?? '')
  const [role, setRole] = useState<RequirementRole>('main')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const saveView = async (): Promise<void> => {
    const trimmedLabel = label.trim()
    const trimmedDescription = description.trim() === '' ? null : description.trim()
    if (trimmedLabel === '' || (trimmedLabel === view.label && trimmedDescription === view.description)) return
    try {
      await api(`/api/patterns/${patternId}/views/${view.id}`, {
        method: 'PUT',
        body: { label: trimmedLabel, description: trimmedDescription },
      })
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the view.')
    }
  }

  const removeView = async (): Promise<void> => {
    await api(`/api/patterns/${patternId}/views/${view.id}`, { method: 'DELETE' })
    onChanged()
  }

  const addRequirement = async (): Promise<void> => {
    const lengthMm = length.trim() === '' ? null : toStored(parsedNumber(length), 'fabricLength', unit)
    const fabricWidthMm = width.trim() === '' ? null : toStored(parsedNumber(width), 'fabricWidth', unit)
    setError(null)
    try {
      await api(`/api/patterns/${patternId}/views/${view.id}/requirements`, {
        method: 'POST',
        body: { role, lengthMm, fabricWidthMm, note: note.trim() === '' ? null : note.trim() },
      })
      setLength('')
      setWidth('')
      setNote('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the requirement.')
    }
  }

  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: '12px', padding: '0.75rem', marginBottom: '0.75rem' }}>
      <label className="field" htmlFor={`view-label-${view.id}`}>
        <span className="label">View</span>
        <input
          id={`view-label-${view.id}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => void saveView()}
        />
      </label>
      <label className="field" htmlFor={`view-description-${view.id}`}>
        <span className="label">Description (optional)</span>
        <input
          id={`view-description-${view.id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void saveView()}
        />
      </label>

      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Requirements
      </span>
      {view.requirements.length === 0 && <p className="muted">No requirements yet — how much cloth does this view take?</p>}
      {view.requirements.map((requirement) => (
        <RequirementRow
          key={requirement.id}
          patternId={patternId}
          viewId={view.id}
          requirement={requirement}
          onChanged={onChanged}
        />
      ))}

      <div style={{ borderTop: '1px solid var(--line)', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
        <label className="field" htmlFor={`new-role-${view.id}`}>
          <span className="label">Add a requirement</span>
          <select id={`new-role-${view.id}`} value={role} onChange={(event) => setRole(event.target.value as RequirementRole)}>
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`new-length-${view.id}`}>
          <span className="label">Needs ({unitLabel('fabricLength', unit)})</span>
          <input id={`new-length-${view.id}`} inputMode="numeric" value={length} onChange={(event) => setLength(event.target.value)} />
        </label>
        <label className="field" htmlFor={`new-width-${view.id}`}>
          <span className="label">Fabric width ({unitLabel('fabricWidth', unit)})</span>
          <input id={`new-width-${view.id}`} inputMode="numeric" value={width} onChange={(event) => setWidth(event.target.value)} />
        </label>
        <label className="field" htmlFor={`new-note-${view.id}`}>
          <span className="label">Note (optional)</span>
          <input id={`new-note-${view.id}`} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button type="button" className="button" onClick={() => void addRequirement()}>
          Add requirement
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      <button type="button" className="button plain" onClick={() => void removeView()}>
        Remove view
      </button>
    </section>
  )
}

/** The pattern's views and their yardage requirements — edited in place. */
export function ViewsEditor({ pattern, onChanged }: { pattern: Pattern; onChanged: () => void }) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const addView = async (): Promise<void> => {
    const trimmed = label.trim()
    if (trimmed === '') {
      setError('A view needs a label.')
      return
    }
    setError(null)
    try {
      await api(`/api/patterns/${pattern.id}/views`, {
        method: 'POST',
        body: { label: trimmed, description: description.trim() === '' ? null : description.trim() },
      })
      setLabel('')
      setDescription('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the view.')
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Views and yardage
      </span>

      {pattern.views.length === 0 && <p className="muted">No views yet. A view is one way of cutting the pattern (A, B, C…).</p>}
      {pattern.views.map((view) => (
        <ViewBlock key={view.id} patternId={pattern.id} view={view} onChanged={onChanged} />
      ))}

      <label className="field" htmlFor="new-view-label">
        <span className="label">Add a view</span>
        <input id="new-view-label" placeholder="A" value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="field" htmlFor="new-view-description">
        <span className="label">Description (optional)</span>
        <input
          id="new-view-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="button" className="button" onClick={() => void addView()}>
        Add view
      </button>
    </div>
  )
}
