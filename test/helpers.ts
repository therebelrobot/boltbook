import { openDatabase } from '../server/database'
import { createApplication } from '../server/app'
import type { ServerConfig } from '../server/config'

export const TEST_SETUP_TOKEN = 'test-setup-token'
export const TEST_PASSPHRASE = 'correct horse battery staple'

/** Cheap scrypt so tests run fast; the stored parameters are what a login uses. */
const FAST_SCRYPT = { costFactorN: 2 ** 10, blockSizeR: 8, parallelizationP: 1 }

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    dataDirectory: ':memory:',
    databaseFilePath: ':memory:',
    port: 0,
    host: '127.0.0.1',
    cookieSecure: false,
    trustProxy: false,
    publicOrigin: null,
    sessionIdleMinutes: 30,
    sessionMaxHours: 12,
    setupToken: TEST_SETUP_TOKEN,
    setupTokenWasGenerated: false,
    scryptParameters: FAST_SCRYPT,
    ...overrides,
  }
}

/** A test client that always sends the required request header. */
export interface Client {
  request: (path: string, init?: RequestInit) => Promise<Response>
}

/** A fresh, unclaimed instance — for the auth tests. */
export function anonymousApp(
  overrides: Partial<ServerConfig> = {},
  options: { currentTimeMilliseconds?: () => number } = {},
) {
  const database = openDatabase(':memory:')
  const config = testConfig(overrides)
  const application = createApplication({
    database,
    config,
    currentTimeMilliseconds: options.currentTimeMilliseconds,
  })
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    application.app.request(path, {
      ...init,
      headers: { 'x-boltbook-request': '1', ...(init.headers as Record<string, string> | undefined) },
    })
  return { ...application, request, config }
}

export function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('no set-cookie on response')
  return setCookie.split(';')[0]!
}

/** A fresh instance, claimed and signed in — the default for the store tests. */
export async function freshApp(): Promise<Client> {
  const instance = anonymousApp()
  const setup = await instance.request(
    '/api/setup',
    json({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }),
  )
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`)
  const cookie = cookieFrom(setup)
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    instance.app.request(path, {
      ...init,
      headers: { 'x-boltbook-request': '1', cookie, ...(init.headers as Record<string, string> | undefined) },
    })
  return { request }
}

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/**
 * A fabric with one cut carrying the given piece values — the common shape.
 * Every fabric is born with one empty cut (the piece is measured later), so
 * the cut id is there as soon as the fabric exists.
 */
export async function fabricWithCut(
  app: Client,
  body: Record<string, unknown>,
  cut: Record<string, unknown> = {},
): Promise<{ id: string; cutId: string; lengthMm: number | null; originalLengthMm: number | null }> {
  const fabric = await readJson<{ id: string; cuts: Array<{ id: string }> }>(await app.request('/api/fabrics', json(body)))
  const cutId = fabric.cuts[0]!.id
  if (Object.keys(cut).length === 0) return { id: fabric.id, cutId, lengthMm: null, originalLengthMm: null }
  const updated = await readJson<{ lengthMm: number | null; originalLengthMm: number | null }>(
    await app.request(`/api/fabrics/${fabric.id}/cuts/${cutId}`, put(cut)),
  )
  return { id: fabric.id, cutId, lengthMm: updated.lengthMm, originalLengthMm: updated.originalLengthMm }
}
