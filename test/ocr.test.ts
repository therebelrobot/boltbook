import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp } from './helpers'

test('the CSP allows WebAssembly for the local OCR core, without blanket eval', async () => {
  const app = await freshApp()
  const policy = (await app.request('/api/status')).headers.get('content-security-policy') ?? ''
  const scriptSource = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src'))

  assert.ok(scriptSource, 'no script-src in the policy')
  assert.match(scriptSource, /'wasm-unsafe-eval'/)
  // The narrower token permits WASM compilation; it is not a general eval grant.
  assert.equal(scriptSource.includes("'unsafe-eval'"), false)
})
