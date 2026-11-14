import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'

interface Notion {
  id: string
  name: string
  kind: string | null
  quantity: number | null
  location: string | null
}

test('create, list and fetch a notion', async () => {
  const app = await freshApp()
  const created = await app.request(
    '/api/notions',
    json({ name: 'Metal zipper 20cm', kind: 'zipper', colour: 'brass', quantity: 5, unit: 'piece' }),
  )
  assert.equal(created.status, 201)
  const notion = await readJson<Notion>(created)
  assert.equal(notion.kind, 'zipper')
  assert.equal(notion.quantity, 5)

  const listed = await readJson<Notion[]>(await app.request('/api/notions'))
  assert.equal(listed.length, 1)
})

test('a notion needs a name and a known kind', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/notions', json({ name: '' }))).status, 400)
  assert.equal((await app.request('/api/notions', json({ name: 'Zip', kind: 'zipper-ish' }))).status, 400)
  // Thread is its own entity now, so it is no longer a notion kind.
  assert.equal((await app.request('/api/notions', json({ name: 'Thread', kind: 'thread' }))).status, 400)
})

test('replace and delete', async () => {
  const app = await freshApp()
  const notion = await readJson<Notion>(await app.request('/api/notions', json({ name: 'Elastic', kind: 'elastic' })))
  const updated = await app.request(
    `/api/notions/${notion.id}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Elastic', kind: 'elastic', quantity: 2, unit: 'm' }),
    },
  )
  assert.equal(updated.status, 200)
  assert.equal((await readJson<Notion>(updated)).quantity, 2)

  assert.equal((await app.request(`/api/notions/${notion.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/notions/${notion.id}`)).status, 404)
})

test('filters narrow by kind', async () => {
  const app = await freshApp()
  await app.request('/api/notions', json({ name: 'Buttons', kind: 'button' }))
  await app.request('/api/notions', json({ name: 'Zips', kind: 'zipper' }))

  const buttons = await readJson<Notion[]>(await app.request('/api/notions?kind=button'))
  assert.deepEqual(buttons.map((n) => n.name), ['Buttons'])
})

test('an unknown kind filter is refused', async () => {
  const app = await freshApp()
  assert.equal((await app.request('/api/notions?kind=nonsense')).status, 400)
})
