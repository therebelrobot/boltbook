import { useState } from 'react'
import { api } from '../api'
import { useToast } from './Toast'
import { formatStored, fromStored, toStored, unitLabel } from '../units'
import { useUnit } from '../unitPreference'
import type { FabricCut } from '../../shared/model'

/**
 * The cuts of one fabric, edited where they live: the piece's remaining length,
 * what it was bought as, its price and the day it arrived. The fabric's own
 * totals are the sum of these — there is no second number to keep in step.
 *
 * A cut cannot move to another fabric and the last one cannot be deleted (the
 * server refuses both); the piece is what the person physically cut.
 */
export function CutsEditor({ fabricId, cuts, onChanged }: { fabricId: string; cuts: readonly FabricCut[]; onChanged: () => void }) {
  const toast = useToast()
  return (
    <div className="cuts-editor">
      <span className="label" style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Cuts
      </span>
      <p className="muted small" style={{ marginTop: 0 }}>
        {cuts.length === 1 ? 'One piece.' : `${cuts.length} pieces.`} What is left is their sum.
      </p>

      {cuts.map((cut) => (
        <CutRow key={cut.id} fabricId={fabricId} cut={cut} canRemove={cuts.length > 1} onChanged={onChanged} toast={toast} />
      ))}

      <button
        type="button"
        className="button"
        onClick={() =>
          void (async () => {
            try {
              await api(`/api/fabrics/${fabricId}/cuts`, {
                method: 'POST',
                body: { lengthMm: null, originalLengthMm: null, costMinor: null, currency: null, acquiredOn: null },
              })
              onChanged()
            } catch (caught) {
              toast({ message: caught instanceof Error ? caught.message : 'Could not add the cut.' })
            }
          })()
        }
      >
        Add a cut
      </button>
    </div>
  )
}

interface CutRowProps {
  fabricId: string
  cut: FabricCut
  canRemove: boolean
  onChanged: () => void
  toast: ReturnType<typeof useToast>
}

function CutRow({ fabricId, cut, canRemove, onChanged, toast }: CutRowProps) {
  const { unit } = useUnit()
  const [values, setValues] = useState(() => ({
    remaining: cut.lengthMm === null ? '' : String(fromStored(cut.lengthMm, 'fabricLength', unit)),
    bought: cut.originalLengthMm === null ? '' : String(fromStored(cut.originalLengthMm, 'fabricLength', unit)),
    price: cut.costMinor === null ? '' : (cut.costMinor / 100).toString(),
    currency: cut.currency ?? '',
    acquiredOn: cut.acquiredOn ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toNumberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const price = toNumberOrNull(values.price)
      await api(`/api/fabrics/${fabricId}/cuts/${cut.id}`, {
        method: 'PUT',
        body: {
          lengthMm: toNumberOrNull(values.remaining) === null ? null : toStored(toNumberOrNull(values.remaining)!, 'fabricLength', unit),
          originalLengthMm: toNumberOrNull(values.bought) === null ? null : toStored(toNumberOrNull(values.bought)!, 'fabricLength', unit),
          costMinor: price === null ? null : Math.round(price * 100),
          currency: values.currency.trim() === '' ? null : values.currency.trim().toUpperCase(),
          acquiredOn: values.acquiredOn.trim() === '' ? null : values.acquiredOn.trim(),
        },
      })
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the cut.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/fabrics/${fabricId}/cuts/${cut.id}`, { method: 'DELETE' })
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the cut.')
    } finally {
      setBusy(false)
    }
  }

  const remainingLabel = formatStored(cut.lengthMm, 'fabricLength', unit)

  return (
    <div className="cut-row">
      <div className="cut-head">
        <b>{cut.lengthMm === null ? `Cut ${cut.position + 1} — unmeasured` : `Cut ${cut.position + 1} — ${remainingLabel} left`}</b>
        {canRemove && (
          <button type="button" className="button plain" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      <div className="cut-fields">
        <label className="field">
          <span className="label">Remaining ({unitLabel('fabricLength', unit)})</span>
          <input inputMode="decimal" value={values.remaining} onChange={(event) => setValues((c) => ({ ...c, remaining: event.target.value }))} />
        </label>
        <label className="field">
          <span className="label">Bought ({unitLabel('fabricLength', unit)})</span>
          <input inputMode="decimal" value={values.bought} onChange={(event) => setValues((c) => ({ ...c, bought: event.target.value }))} />
        </label>
        <label className="field">
          <span className="label">Price</span>
          <input inputMode="decimal" value={values.price} onChange={(event) => setValues((c) => ({ ...c, price: event.target.value }))} />
        </label>
        <label className="field">
          <span className="label">Currency</span>
          <input autoCapitalize="characters" maxLength={3} value={values.currency} onChange={(event) => setValues((c) => ({ ...c, currency: event.target.value }))} />
        </label>
        <label className="field">
          <span className="label">Acquired</span>
          <input placeholder="YYYY-MM-DD" value={values.acquiredOn} onChange={(event) => setValues((c) => ({ ...c, acquiredOn: event.target.value }))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="button" disabled={busy} onClick={() => void save()}>
        Save cut
      </button>
    </div>
  )
}
