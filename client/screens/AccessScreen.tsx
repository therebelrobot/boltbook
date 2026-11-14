import { useState, type FormEvent } from 'react'
import { claim, signIn } from '../api'
import type { AuthStatus } from '../../shared/model'

interface AccessScreenProps {
  status: AuthStatus
  onSignedIn: () => void
}

/** Setup, then sign-in. One person, one box (design brief §4). */
export function AccessScreen({ status, onSignedIn }: AccessScreenProps) {
  const [setupToken, setSetupToken] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [needsCode, setNeedsCode] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (!status.claimed) await claim(setupToken, passphrase)
      else await signIn(passphrase, totpCode || undefined)
      onSignedIn()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not sign in.'
      setError(message)
      if (message.toLowerCase().includes('authenticator')) setNeedsCode(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>boltbook</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Every bolt, every pattern, in one book.
      </p>
      <form className="centre-card" onSubmit={submit}>
        {!status.claimed ? (
          <>
            <p style={{ marginTop: 0 }}>Claim this instance with the setup token from the server log.</p>
            <label className="field" htmlFor="setup-token">
              <span className="label">Setup token</span>
              <input
                id="setup-token"
                autoCapitalize="none"
                autoCorrect="off"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
              />
            </label>
            <label className="field" htmlFor="new-passphrase">
              <span className="label">Choose a passphrase (12+ characters)</span>
              <input
                id="new-passphrase"
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field" htmlFor="passphrase">
              <span className="label">Passphrase</span>
              <input
                id="passphrase"
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
            {needsCode && (
              <label className="field" htmlFor="totp">
                <span className="label">Authenticator code</span>
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                />
              </label>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="button primary" disabled={busy} style={{ width: '100%' }}>
          {status.claimed ? 'Sign in' : 'Claim this instance'}
        </button>
      </form>
    </div>
  )
}
