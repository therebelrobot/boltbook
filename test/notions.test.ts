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
  const app = freshApp()
  const created = await app.request(
    '/api/notions',
    json({ name: 'Gütermann Mara 120', kind: 'thread', colour: 'ecru', quantity: 4, unit: 'spool' }),
  )
  assert.equal(created.status, 201)
  const notion = await readJson<Notion>(created)
  assert.equal(notion.kind, 'thread')
  assert.equal(notion.quantity, 4)

  const listed = await readJson<Notion[]>(await app.request('/api/notions'))
  assert.equal(listed.length, 1)
})

test('a notion needs a name and a known kind', async () => {
  const app = freshApp()
  assert.equal((await app.request('/api/notions', json({ name: '' }))).status, 400)
  assert.equal((await app.request('/api/notions', json({ name: 'Zip', kind: 'zipper-ish' }))).status, 400)
})

test('replace and delete', async () => {
  const app = freshApp()
  const notion = await readJson<Notion>(await app.request('/api/notions', json({ name: 'Elastic', kind: 'elastic' })))
  const updated = await app.request(
    `/api/notions/${notion.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Elastic', kind: 'elastic', quantity: 2, unit: 'm' }) },
  )
  assert.equal(updated.status, 200)
  assert.equal((await readJson<Notion>(updated)).quantity, 2)

  assert.equal((await app.request(`/api/notions/${notion.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/notions/${notion.id}`)).status, 404)
})

test('filters narrow by kind', async () => {
  const app = freshApp()
  await app.request('/api/notions', json({ name: 'Buttons', kind: 'button' }))
  await app.request('/api/notions', json({ name: 'Thread', kind: 'thread' }))

  const buttons = await readJson<Notion[]>(await app.request('/api/notions?kind=button'))
  assert.deepEqual(buttons.map((n) => n.name), ['Buttons'])
})

test('an unknown kind filter is refused', async () => {
  const response = await freshApp().request('/api/notions?kind=nonsense')
  assert.equal(response.status, 400)
})
