import { openDatabase } from '../server/database'
import { createApplication } from '../server/app'

/** A fresh in-memory instance per test — no file, no shared state. */
export function freshApp() {
  const database = openDatabase(':memory:')
  return createApplication({ database }).app
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
