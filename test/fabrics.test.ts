import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'

test('an empty instance reports zero of everything', async () => {
  const app = await freshApp()
  const response = await app.request('/api/summary')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    fabricCount: 0,
    patternCount: 0,
    notionCount: 0,
    threadCount: 0,
    toolCount: 0,
    projectCount: 0,
  })
})

test('create, list and fetch a fabric', async () => {
  const app = await freshApp()
  const created = await app.request(
    '/api/fabrics',
    json({ name: 'Washed linen', fibre: 'linen', lengthMm: 3000, originalLengthMm: 3000, location: 'Bin A' }),
  )
  assert.equal(created.status, 201)
  const fabric = await readJson<{ id: string; name: string; lengthMm: number }>(created)
  assert.equal(fabric.name, 'Washed linen')
  assert.equal(fabric.lengthMm, 3000)

  const listed = await readJson<unknown[]>(await app.request('/api/fabrics'))
  assert.equal(listed.length, 1)

  const fetched = await app.request(`/api/fabrics/${fabric.id}`)
  assert.equal(fetched.status, 200)
  assert.equal((await readJson<{ id: string }>(fetched)).id, fabric.id)
})

test('a fabric with no name is refused', async () => {
  const app = await freshApp()
  const response = await app.request('/api/fabrics', json({ name: '' }))
  assert.equal(response.status, 400)
  assert.equal((await readJson<{ error: string }>(response)).error, 'invalid_request')
})

test('remaining length cannot exceed original length', async () => {
  const app = await freshApp()
  const response = await app.request('/api/fabrics', json({ name: 'Odd bolt', lengthMm: 5000, originalLengthMm: 3000 }))
  assert.equal(response.status, 400)
})

test('replace changes fields and keeps identity', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Poplin', lengthMm: 2000 })))
  const updated = await app.request(
    `/api/fabrics/${fabric.id}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Poplin', lengthMm: 1500, fibre: 'cotton' }),
    },
  )
  assert.equal(updated.status, 200)
  const body = await readJson<{ id: string; lengthMm: number; fibre: string }>(updated)
  assert.equal(body.id, fabric.id)
  assert.equal(body.lengthMm, 1500)
  assert.equal(body.fibre, 'cotton')
})

test('fetching or replacing a missing fabric is a 404', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/fabrics/nope')).status, 404)
  const replaced = await app.request('/api/fabrics/nope', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'X' }),
  })
  assert.equal(replaced.status, 404)
})

test('delete removes the fabric', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Canvas' })))
  assert.equal((await app.request(`/api/fabrics/${fabric.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/fabrics/${fabric.id}`)).status, 404)
})

test('filters narrow by fibre and by minimum length', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', fibre: 'linen', lengthMm: 3000 }))
  await app.request('/api/fabrics', json({ name: 'Cotton', fibre: 'cotton', lengthMm: 500 }))

  const linen = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?fibre=linen'))
  assert.deepEqual(linen.map((f) => f.name), ['Linen'])

  const longEnough = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?minLengthMm=1000'))
  assert.deepEqual(longEnough.map((f) => f.name), ['Linen'])
})
