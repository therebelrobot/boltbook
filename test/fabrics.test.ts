import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../server/database'
import { createApplication } from '../server/app'
import { buildMatchQuery } from '../server/repositories/fabrics'

function freshApp() {
  const database = openDatabase(':memory:')
  return createApplication({ database }).app
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('an empty instance reports zero fabrics', async () => {
  const response = await freshApp().request('/api/status')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, fabricCount: 0 })
})

test('create, list and fetch a fabric', async () => {
  const app = freshApp()
  const created = await app.request(
    '/api/fabrics',
    json({ name: 'Washed linen', fibre: 'linen', lengthMm: 3000, originalLengthMm: 3000, location: 'Bin A' }),
  )
  assert.equal(created.status, 201)
  const fabric = (await created.json()) as { id: string; name: string; lengthMm: number }
  assert.equal(fabric.name, 'Washed linen')
  assert.equal(fabric.lengthMm, 3000)

  const listed = (await (await app.request('/api/fabrics')).json()) as unknown[]
  assert.equal(listed.length, 1)

  const fetched = await app.request(`/api/fabrics/${fabric.id}`)
  assert.equal(fetched.status, 200)
  assert.equal(((await fetched.json()) as { id: string }).id, fabric.id)
})

test('a fabric with no name is refused', async () => {
  const response = await freshApp().request('/api/fabrics', json({ name: '' }))
  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: string }
  assert.equal(body.error, 'invalid_request')
})

test('remaining length cannot exceed original length', async () => {
  const response = await freshApp().request(
    '/api/fabrics',
    json({ name: 'Odd bolt', lengthMm: 5000, originalLengthMm: 3000 }),
  )
  assert.equal(response.status, 400)
})

test('replace changes fields and keeps identity', async () => {
  const app = freshApp()
  const fabric = (await (await app.request('/api/fabrics', json({ name: 'Poplin', lengthMm: 2000 }))).json()) as {
    id: string
  }
  const updated = await app.request(
    `/api/fabrics/${fabric.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Poplin', lengthMm: 1500, fibre: 'cotton' }) },
  )
  assert.equal(updated.status, 200)
  const body = (await updated.json()) as { id: string; lengthMm: number; fibre: string }
  assert.equal(body.id, fabric.id)
  assert.equal(body.lengthMm, 1500)
  assert.equal(body.fibre, 'cotton')
})

test('fetching or replacing a missing fabric is a 404', async () => {
  const app = freshApp()
  assert.equal((await app.request('/api/fabrics/nope')).status, 404)
  const replaced = await app.request('/api/fabrics/nope', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'X' }),
  })
  assert.equal(replaced.status, 404)
})

test('delete removes the fabric', async () => {
  const app = freshApp()
  const fabric = (await (await app.request('/api/fabrics', json({ name: 'Canvas' }))).json()) as { id: string }
  assert.equal((await app.request(`/api/fabrics/${fabric.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/fabrics/${fabric.id}`)).status, 404)
})

test('filters narrow by fibre and by minimum length', async () => {
  const app = freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', fibre: 'linen', lengthMm: 3000 }))
  await app.request('/api/fabrics', json({ name: 'Cotton', fibre: 'cotton', lengthMm: 500 }))

  const linen = (await (await app.request('/api/fabrics?fibre=linen')).json()) as Array<{ name: string }>
  assert.deepEqual(linen.map((f) => f.name), ['Linen'])

  const longEnough = (await (await app.request('/api/fabrics?minLengthMm=1000')).json()) as Array<{ name: string }>
  assert.deepEqual(longEnough.map((f) => f.name), ['Linen'])
})

test('search finds a fabric by a field and by a prefix', async () => {
  const app = freshApp()
  await app.request('/api/fabrics', json({ name: 'Chambray shirting', fibre: 'cotton', notes: 'lightweight for a shirt' }))
  await app.request('/api/fabrics', json({ name: 'Wool coating', fibre: 'wool' }))

  const byFibre = (await (await app.request('/api/search?q=cotton')).json()) as Array<{ title: string }>
  assert.deepEqual(byFibre.map((h) => h.title), ['Chambray shirting'])

  const byPrefix = (await (await app.request('/api/search?q=chamb')).json()) as Array<{ title: string }>
  assert.deepEqual(byPrefix.map((h) => h.title), ['Chambray shirting'])

  const none = (await (await app.request('/api/search?q=silk')).json()) as unknown[]
  assert.deepEqual(none, [])
})

test('a search query full of punctuation does not throw', async () => {
  const app = freshApp()
  await app.request('/api/fabrics', json({ name: 'Ticking stripe' }))
  const response = await app.request(`/api/search?q=${encodeURIComponent('"weird" * AND (')}`)
  assert.equal(response.status, 200)
})

test('buildMatchQuery quotes every term', () => {
  assert.equal(buildMatchQuery('washed linen'), '"washed"* AND "linen"*')
  assert.equal(buildMatchQuery('  '), null)
})
