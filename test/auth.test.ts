import test from 'node:test'
import assert from 'node:assert/strict'
import { anonymousApp, cookieFrom, freshApp, json, readJson, TEST_PASSPHRASE, TEST_SETUP_TOKEN } from './helpers'
import { computeTimeStepCounter, generateTotpCode } from '../server/crypto/totp'
import { decodeBase32 } from '../server/crypto/base32'

const signIn = (app: { request: (p: string, i?: RequestInit) => Promise<Response> }, body: unknown) =>
  app.request('/api/login', json(body))

test('a fresh instance is unclaimed and signed out', async () => {
  const app = anonymousApp()
  const status = await readJson<{ claimed: boolean; signedIn: boolean; totpEnabled: boolean }>(await app.request('/api/status'))
  assert.deepEqual(status.claimed, false)
  assert.deepEqual(status.signedIn, false)
  assert.deepEqual(status.totpEnabled, false)
})

test('the setup token claims the instance, once', async () => {
  const app = anonymousApp()
  const first = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  assert.equal(first.status, 201)
  assert.ok(cookieFrom(first).startsWith('boltbook_session='))

  const second = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  assert.equal(second.status, 409)
  assert.equal((await readJson<{ error: string }>(second)).error, 'already_claimed')
})

test('a wrong setup token does not claim the instance', async () => {
  const app = anonymousApp()
  const response = await app.request('/api/setup', json({ setupToken: 'nope', passphrase: TEST_PASSPHRASE }))
  assert.equal(response.status, 401)
  assert.equal((await readJson<{ error: string }>(response)).error, 'wrong_setup_token')
  assert.equal((await readJson<{ claimed: boolean }>(await app.request('/api/status'))).claimed, false)
})

test('a weak passphrase is refused', async () => {
  const app = anonymousApp()
  const response = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: 'short' }))
  assert.equal(response.status, 400)
  assert.equal((await readJson<{ error: string }>(response)).error, 'weak_passphrase')
})

test('data routes need a session', async () => {
  const app = anonymousApp()
  await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  // Setup left a cookie on that local response, but a request with no cookie is refused.
  const response = await anonymousApp().request('/api/fabrics')
  assert.equal(response.status, 401)
})

test('a state-changing request without the custom header is refused', async () => {
  const app = anonymousApp()
  // Bypass the helper (which injects the header) to test the guard itself.
  const response = await app.app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: TEST_PASSPHRASE }),
  })
  assert.equal(response.status, 403)
})

test('sign in with the right passphrase, and not with the wrong one', async () => {
  const app = anonymousApp()
  await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  await app.request('/api/logout')

  const wrong = await signIn(app, { passphrase: 'not the passphrase' })
  assert.equal(wrong.status, 401)
  assert.equal((await readJson<{ error: string }>(wrong)).error, 'wrong_credentials')

  const right = await signIn(app, { passphrase: TEST_PASSPHRASE })
  assert.equal(right.status, 200)
  const cookie = cookieFrom(right)

  const withSession = await app.request('/api/summary', { headers: { cookie } })
  assert.equal(withSession.status, 200)
})

test('too many failed attempts are rate limited', async () => {
  const app = anonymousApp()
  await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  await app.request('/api/logout')

  let last = 0
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = (await signIn(app, { passphrase: 'wrong' })).status
  }
  assert.equal(last, 429)
})

test('changing the passphrase retires the old one', async () => {
  const app = anonymousApp()
  const setup = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  const cookie = cookieFrom(setup)

  const changed = await app.request('/api/passphrase', {
    ...json({ currentPassphrase: TEST_PASSPHRASE, newPassphrase: 'a brand new passphrase' }),
    headers: { 'content-type': 'application/json', cookie },
  })
  assert.equal(changed.status, 200)

  assert.equal((await signIn(app, { passphrase: TEST_PASSPHRASE })).status, 401)
  assert.equal((await signIn(app, { passphrase: 'a brand new passphrase' })).status, 200)
})

test('enrolling an authenticator gates the next sign-in', async () => {
  let now = 1_700_000_000_000
  const app = anonymousApp({}, { currentTimeMilliseconds: () => now })
  const setup = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  const cookie = cookieFrom(setup)

  const begun = await app.request('/api/totp/begin', { method: 'POST', headers: { cookie } })
  const { secretBase32 } = await readJson<{ secretBase32: string }>(begun)
  const secret = decodeBase32(secretBase32)

  const confirmed = await app.request('/api/totp/confirm', {
    ...json({ code: generateTotpCode(secret, computeTimeStepCounter(now)) }),
    headers: { 'content-type': 'application/json', cookie },
  })
  assert.equal(confirmed.status, 200)

  await app.request('/api/logout')
  const withoutCode = await signIn(app, { passphrase: TEST_PASSPHRASE })
  assert.equal(withoutCode.status, 401)
  assert.equal((await readJson<{ error: string }>(withoutCode)).error, 'totp_required')

  // Advance one step: the confirm-time counter may not be reused.
  now += 30_000
  const loginCode = generateTotpCode(secret, computeTimeStepCounter(now))
  const withCode = await signIn(app, { passphrase: TEST_PASSPHRASE, totpCode: loginCode })
  assert.equal(withCode.status, 200)

  // The same code again is refused: it may not be replayed.
  const replayed = await signIn(app, { passphrase: TEST_PASSPHRASE, totpCode: loginCode })
  assert.equal(replayed.status, 401)
})

test('the audit log records claims and sign-ins', async () => {
  const app = anonymousApp()
  const setup = await app.request('/api/setup', json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }))
  const cookie = cookieFrom(setup)
  await app.request('/api/logout', { method: 'POST', headers: { cookie } })
  const signed = await signIn(app, { passphrase: TEST_PASSPHRASE })
  const sessionCookie = cookieFrom(signed)

  const entries = await readJson<Array<{ event: string }>>(
    await app.request('/api/audit', { headers: { cookie: sessionCookie } }),
  )
  const events = entries.map((entry) => entry.event)
  assert.ok(events.includes('instance_claimed'))
  assert.ok(events.includes('signed_in'))
})

test('a claimed instance signs in through the store helper', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/summary')).status, 200)
})
