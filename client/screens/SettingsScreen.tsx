import { useEffect, useState } from 'react'
import { api, signOut } from '../api'
import { Sheet } from '../components/Sheet'
import { joinMeta } from '../format'
import { useUnit } from '../unitPreference'
import type { Status } from '../../shared/model'

interface AuditEntry {
  at: string
  event: string
  ipAddress: string
  userAgent: string
}

interface SettingsScreenProps {
  onClose: () => void
  onSignedOut: () => void
}

export function SettingsScreen({ onClose, onSignedOut }: SettingsScreenProps) {
  const { unit, setUnit } = useUnit()
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
