import { useEffect, useRef, useState } from 'react'
import { api, restoreExport, signOut } from '../api'
import { Sheet } from '../components/Sheet'
import { joinMeta } from '../format'
import { useUnit } from '../unitPreference'
import type { Status, Tag } from '../../shared/model'

interface AuditEntry {
  at: string
  event: string
  ipAddress: string
  userAgent: string
}

interface SettingsScreenProps {
  onClose: () => void
  onOpenLabels: () => void
  onSignedOut: () => void
}

/**
 * Tag hygiene. The vocabulary converges by design but still drifts — `linen`,
 * `Linen`, `linnen` — and editing every record by hand is the only fix without
 * this. Rename moves every link (the id does not change); a merge folds one tag
 * into another; the unused can go.
 */
function TagManager() {
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      setTags(await api<Tag[]>('/api/tags'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the tags.')
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const act = async (work: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      setNote(await work())
      setError(null)
      setRenaming(null)
      setMerging(null)
      setMergeTarget('')
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const rename = (id: string, name: string): void =>
    void act(async () => {
      await api(`/api/tags/${id}`, { method: 'PATCH', body: { name } })
      return `Renamed to ${name.trim()}.`
    })

  const merge = (id: string, into: string): void =>
    void act(async () => {
      const target = tags?.find((tag) => tag.id === into)?.name ?? 'another tag'
      await api(`/api/tags/${id}/merge`, { method: 'POST', body: { into } })
      return `Merged into ${target}.`
    })

  const remove = (id: string, name: string): void => {
    if (!window.confirm(`Delete the tag "${name}"? The records themselves stay.`)) return
    void act(async () => {
      await api(`/api/tags/${id}`, { method: 'DELETE' })
      return `Deleted ${name}.`
    })
  }

  const deleteUnused = (): void => {
    const unused = (tags ?? []).filter((tag) => tag.usageCount === 0)
    if (unused.length === 0) return
    if (!window.confirm(`Delete ${unused.length} unused tag${unused.length === 1 ? '' : 's'}? The records themselves stay.`)) return
    void act(async () => {
      for (const tag of unused) await api(`/api/tags/${tag.id}`, { method: 'DELETE' })
      return `Deleted ${unused.length} unused tag${unused.length === 1 ? '' : 's'}.`
    })
  }

  const unusedCount = (tags ?? []).filter((tag) => tag.usageCount === 0).length

  return (
    <>
      {tags === null && !error && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {note && <p className="muted">{note}</p>}

      {tags !== null && tags.length === 0 && <p className="muted">No tags yet.</p>}

      {tags !== null && tags.length > 0 && (
        <div className="card">
          {tags.map((tag) => (
            <div className="row" key={tag.id} style={{ cursor: 'default', minHeight: 48, flexWrap: merging === tag.id ? 'wrap' : undefined }}>
              {renaming?.id === tag.id ? (
                <span className="body">
                  <input
                    value={renaming.name}
                    autoFocus
                    onChange={(event) => setRenaming({ id: tag.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') rename(tag.id, renaming.name)
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                  />
                </span>
              ) : (
                <span className="body">
                  <span className="title">#{tag.name}</span>
                  <span className="meta">
                    {tag.usageCount === 0 ? 'unused' : `on ${tag.usageCount} record${tag.usageCount === 1 ? '' : 's'}`}
                  </span>
                </span>
              )}

              {merging === tag.id ? (
                <span className="inline-actions" style={{ flex: '1 1 100%' }}>
                  <select
                    aria-label="Merge into"
                    value={mergeTarget}
                    style={{ flex: 1 }}
                    onChange={(event) => setMergeTarget(event.target.value)}
                  >
                    <option value="">—</option>
                    {tags!.filter((other) => other.id !== tag.id).map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="button plain" disabled={busy || !mergeTarget} onClick={() => merge(tag.id, mergeTarget)}>
                    Merge
                  </button>
                  <button type="button" className="button plain" onClick={() => setMerging(null)}>
                    Cancel
                  </button>
                </span>
              ) : renaming?.id === tag.id ? (
                <span className="inline-actions">
                  <button type="button" className="button plain" disabled={busy} onClick={() => rename(tag.id, renaming.name)}>
                    Save
                  </button>
                  <button type="button" className="button plain" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="inline-actions">
                  <button type="button" className="button plain" onClick={() => setRenaming({ id: tag.id, name: tag.name })}>
                    Rename
                  </button>
                  {tags!.length > 1 && (
                    <button type="button" className="button plain" onClick={() => setMerging(tag.id)}>
                      Merge
                    </button>
                  )}
                  {tag.usageCount === 0 && (
                    <button type="button" className="button plain" onClick={() => remove(tag.id, tag.name)}>
                      Delete
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {unusedCount > 0 && (
        <button type="button" className="button" disabled={busy} onClick={deleteUnused}>
          Delete {unusedCount} unused tag{unusedCount === 1 ? '' : 's'}
        </button>
      )}
    </>
  )
}

export function SettingsScreen({ onClose, onOpenLabels, onSignedOut }: SettingsScreenProps) {
  const { unit, setUnit } = useUnit()
  const fileRef = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<Status | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [secret, setSecret] = useState<string | null>(null)
  const [otpauth, setOtpauth] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setSummary(await api<Status>('/api/summary'))
      setAudit(await api<AuditEntry[]>('/api/audit'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load settings.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const beginTotp = async (): Promise<void> => {
    try {
      const result = await api<{ secretBase32: string; otpauthUri: string }>('/api/totp/begin', { method: 'POST', body: {} })
      setSecret(result.secretBase32)
      setOtpauth(result.otpauthUri)
      setNote(null)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start setup.')
    }
  }

  const confirmTotp = async (): Promise<void> => {
    try {
      await api('/api/totp/confirm', { method: 'POST', body: { code } })
      setSecret(null)
      setOtpauth(null)
      setCode('')
      setNote('Authenticator enabled.')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That code did not match.')
    }
  }

  const disableTotp = async (): Promise<void> => {
    try {
      await api('/api/totp/disable', { method: 'POST', body: { passphrase } })
      setPassphrase('')
      setNote('Authenticator disabled.')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disable.')
    }
  }

  const leave = async (): Promise<void> => {
    await signOut()
    onSignedOut()
  }

  const restore = async (file: File | null): Promise<void> => {
    if (!file) return
    if (!window.confirm('Replace every record in this instance with the contents of that export?')) return
    setError(null)
    try {
      const result = await restoreExport(file)
      const fabrics = result.imported.fabric ?? 0
      const patterns = result.imported.pattern ?? 0
      setNote(
        `Restored ${fabrics} fabric${fabrics === 1 ? '' : 's'}, ${patterns} pattern${patterns === 1 ? '' : 's'}, ` +
          `${result.photos} photo${result.photos === 1 ? '' : 's'} and ` +
          `${result.patternFiles} pattern PDF${result.patternFiles === 1 ? '' : 's'}.`,
      )
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore that export.')
    }
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      {summary && (
        <div className="counts">
          <div className="metric">
            <b>{summary.fabricCount}</b>
            <span>fabrics</span>
          </div>
          <div className="metric">
            <b>{summary.patternCount}</b>
            <span>patterns</span>
          </div>
          <div className="metric">
            <b>{summary.threadCount}</b>
            <span>threads</span>
          </div>
          <div className="metric">
            <b>{summary.notionCount + summary.toolCount}</b>
            <span>notions &amp; tools</span>
          </div>
          <div className="metric">
            <b>{summary.projectCount}</b>
            <span>projects</span>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: '0.9375rem' }}>Units</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Lengths are stored in millimetres either way; this only changes what you read and type.
      </p>
      <div className="segmented" role="group" aria-label="Units">
        <button type="button" aria-pressed={unit === 'metric'} onClick={() => setUnit('metric')}>
          Metric
        </button>
        <button type="button" aria-pressed={unit === 'imperial'} onClick={() => setUnit('imperial')}>
          Imperial
        </button>
      </div>

      <h3 style={{ fontSize: '0.9375rem' }}>Tags</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        The vocabulary drifts — linen, Linen, linnen. Renaming moves every record with it; a merge
        folds one tag into another; unused tags can go.
      </p>
      <TagManager />

      <h3 style={{ fontSize: '0.9375rem', marginTop: '1.25rem' }}>Storage labels</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        A printable sheet of QR labels, one per location. Scanning one opens everything stored
        there — fabric, thread, notions and tools together.
      </p>
      <button type="button" className="button" onClick={onOpenLabels}>
        Print storage labels
      </button>

      <h3 style={{ fontSize: '0.9375rem' }}>Authenticator</h3>
      {secret ? (
        <>
          <p className="muted">Add this secret to your authenticator app, then enter the code it shows.</p>
          <p style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>{secret}</p>
          {otpauth && (
            <p>
              <a href={otpauth}>Open in the authenticator app</a>
            </p>
          )}
          <label className="field" htmlFor="totp-code">
            <span className="label">Code</span>
            <input id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <button type="button" className="button primary" onClick={() => void confirmTotp()}>
            Confirm
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button" onClick={() => void beginTotp()}>
            Set up an authenticator
          </button>
          <label className="field" htmlFor="disable-passphrase" style={{ marginTop: '0.75rem' }}>
            <span className="label">Passphrase (to turn it off)</span>
            <input
              id="disable-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <button type="button" className="button" onClick={() => void disableTotp()}>
            Turn off authenticator
          </button>
        </>
      )}

      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}

      <h3 style={{ fontSize: '0.9375rem', marginTop: '1.25rem' }}>Export</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        One zip: every record as JSON, every photo and pattern PDF as a file. Credentials are never
        included.
      </p>
      <a className="button" href="/api/export" download>
        Download everything (.zip)
      </a>

      <h3 style={{ fontSize: '0.9375rem', marginTop: '1.25rem' }}>Restore</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Replaces every record in this instance with the contents of an export — your tags, views,
        photos, pattern PDFs and projects included. Take an export first if you are unsure.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          void restore(file)
        }}
      />
      <button type="button" className="button danger" onClick={() => fileRef.current?.click()}>
        Restore from an export…
      </button>

      <h3 style={{ fontSize: '0.9375rem', marginTop: '1.25rem' }}>Recent activity</h3>
      <div className="card">
        {audit.slice(0, 12).map((entry) => (
          <div className="row" key={`${entry.at}-${entry.event}`} style={{ cursor: 'default', minHeight: 48 }}>
            <span className="body">
              <span className="title">{entry.event.replace(/_/g, ' ')}</span>
              <span className="meta">{joinMeta([entry.at.slice(0, 16).replace('T', ' '), entry.ipAddress])}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="actions">
        <button type="button" className="button" onClick={() => void leave()}>
          Sign out
        </button>
      </div>
    </Sheet>
  )
}
