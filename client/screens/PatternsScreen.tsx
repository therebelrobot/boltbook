import { useState } from 'react'
import { api } from '../api'
import { useCollection } from '../useCollection'
import { EntitySheet } from '../components/EntitySheet'
import { ViewsEditor } from '../components/ViewsEditor'
import { useToast } from '../components/Toast'
import { PATTERN_FIELDS } from '../fields'
import { joinMeta } from '../format'
import type { Pattern } from '../../shared/model'

const PATHS = '/api/patterns'

export function PatternsScreen() {
  const { items, error, reload } = useCollection<Pattern>(PATHS)
  const toast = useToast()
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
  const record = sheet?.mode === 'edit' ? items?.find((item) => item.id === sheet.id) ?? null : null

  const save = async (values: Record<string, unknown>): Promise<void> => {
    if (sheet?.mode === 'edit') await api(`${PATHS}/${sheet.id}`, { method: 'PUT', body: values })
    else await api(PATHS, { method: 'POST', body: values })
    await reload()
  }

  const remove = async (): Promise<void> => {
    if (sheet?.mode !== 'edit') return
    await api(`${PATHS}/${sheet.id}`, { method: 'DELETE' })
    await reload()
    toast({ message: 'Pattern deleted.' })
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>No patterns yet.</p>
          <button type="button" className="button primary" onClick={() => setSheet({ mode: 'create' })}>
            Add the first pattern
          </button>
        </div>
      ) : (
        <div className="card">
          {items.map((pattern) => (
            <button
              type="button"
              className="row"
              key={pattern.id}
              onClick={() => setSheet({ mode: 'edit', id: pattern.id })}
            >
              <span className="body">
                <span className="title">{pattern.name}</span>
                <span className="meta">
                  {joinMeta([
                    pattern.brand,
                    pattern.number,
                    pattern.category,
                    pattern.sizeMin && `size ${pattern.sizeMin}${pattern.sizeMax ? `–${pattern.sizeMax}` : ''}`,
                    pattern.tags.length > 0 && pattern.tags.map((tag) => `#${tag}`).join(' '),
                  ]) || 'No details yet'}
                </span>
              </span>
              <span className="right">
                {pattern.triedAndTrue ? 'TNT' : pattern.format ?? '—'}
                <span className="sub">{pattern.views.length > 0 ? `${pattern.views.length} view${pattern.views.length === 1 ? '' : 's'}` : 'no views'}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <button type="button" className="fab" onClick={() => setSheet({ mode: 'create' })}>
          Add pattern
        </button>
      )}

      {sheet && (
        <EntitySheet
          key={sheet.mode === 'edit' ? sheet.id : 'new'}
          title={sheet.mode === 'edit' ? 'Edit pattern' : 'New pattern'}
          fields={PATTERN_FIELDS}
          record={record as Record<string, unknown> | null}
          onSave={save}
          onDelete={sheet.mode === 'edit' ? remove : undefined}
          onClose={() => setSheet(null)}
        >
          {sheet.mode === 'edit' && record ? (
            <ViewsEditor pattern={record} onChanged={() => void reload()} />
          ) : (
            <p className="muted">Save the pattern, then add its views and yardage.</p>
          )}
        </EntitySheet>
      )}
    </>
  )
}
