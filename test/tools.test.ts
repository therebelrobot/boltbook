import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'

interface Tool {
  id: string
  name: string
  category: string | null
  needsAttention: boolean
  quantity: number | null
}

test('create and read back a tool', async () => {
  const app = freshApp()
  const created = await app.request(
    '/api/tools',
    json({ name: 'Rotary cutter', category: 'cutting', brand: 'Olfa', spec: '45mm', quantity: 1 }),
  )
  assert.equal(created.status, 201)
  const tool = await readJson<Tool>(created)
  assert.equal(tool.category, 'cutting')
  assert.equal(tool.needsAttention, false)
})

test('a tool needs a name and a known category', async () => {
  const app = freshApp()
  assert.equal((await app.request('/api/tools', json({ name: '' }))).status, 400)
  assert.equal((await app.request('/api/tools', json({ name: 'Awl', category: 'sorcery' }))).status, 400)
})

test('needs-attention round-trips and filters', async () => {
  const app = freshApp()
  await app.request('/api/tools', json({ name: 'Denim needles', category: 'needles_pins', needsAttention: true }))
  await app.request('/api/tools', json({ name: 'Iron', category: 'pressing' }))

  const flagging = await readJson<Tool[]>(await app.request('/api/tools?needsAttention=true'))
  assert.deepEqual(flagging.map((t) => t.name), ['Denim needles'])
  assert.equal(flagging[0]!.needsAttention, true)
})

test('a bad needsAttention value is refused', async () => {
  const response = await freshApp().request('/api/tools?needsAttention=maybe')
  assert.equal(response.status, 400)
})

test('filters narrow by category', async () => {
  const app = freshApp()
  await app.request('/api/tools', json({ name: 'Ruler', category: 'measuring' }))
  await app.request('/api/tools', json({ name: 'Shears', category: 'cutting' }))

  const cutting = await readJson<Tool[]>(await app.request('/api/tools?category=cutting'))
  assert.deepEqual(cutting.map((t) => t.name), ['Shears'])
})

test('replace and delete a tool', async () => {
  const app = freshApp()
  const tool = await readJson<Tool>(await app.request('/api/tools', json({ name: 'Ruler', category: 'measuring' })))
  const updated = await app.request(
    `/api/tools/${tool.id}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ruler', category: 'measuring', quantity: 2 }) },
  )
  assert.equal((await readJson<Tool>(updated)).quantity, 2)
  assert.equal((await app.request(`/api/tools/${tool.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/tools/${tool.id}`)).status, 404)
})
