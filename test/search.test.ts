import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson } from './helpers'
import { buildMatchQuery } from '../server/repositories/search'

interface Hit {
  type: 'fabric' | 'pattern' | 'thread' | 'tool'
  id: string
  title: string
}

test('buildMatchQuery quotes every term as a prefix', () => {
  assert.equal(buildMatchQuery('washed linen'), '"washed"* AND "linen"*')
  assert.equal(buildMatchQuery('  '), null)
})

test('search finds a fabric by a field and by a prefix', async () => {
  const app = freshApp()
  await app.request('/api/fabrics', json({ name: 'Chambray shirting', fibre: 'cotton', notes: 'lightweight for a shirt' }))
  await app.request('/api/fabrics', json({ name: 'Wool coating', fibre: 'wool' }))

  const byFibre = await readJson<Hit[]>(await app.request('/api/search?q=cotton'))
  assert.deepEqual(byFibre.map((h) => h.title), ['Chambray shirting'])

  const byPrefix = await readJson<Hit[]>(await app.request('/api/search?q=chamb'))
  assert.deepEqual(byPrefix.map((h) => h.title), ['Chambray shirting'])

  const none = await readJson<Hit[]>(await app.request('/api/search?q=silk'))
  assert.deepEqual(none, [])
})

test('search finds patterns too, and tags the hit type', async () => {
  const app = freshApp()
  await app.request('/api/patterns', json({ name: 'Archer Button-Up', brand: 'Grainline', category: 'shirts' }))
  await app.request('/api/fabrics', json({ name: 'Shirting cotton', fibre: 'cotton' }))

  const hits = await readJson<Hit[]>(await app.request('/api/search?q=shirt'))
  const types = new Set(hits.map((h) => h.type))
  const titles = hits.map((h) => h.title).sort()
  assert.deepEqual(titles, ['Archer Button-Up', 'Shirting cotton'])
  assert.deepEqual([...types].sort(), ['fabric', 'pattern'])
})

test('search finds a pattern by its brand', async () => {
  const app = freshApp()
  await app.request('/api/patterns', json({ name: 'Ginger Jeans', brand: 'Closet Core' }))
  const hits = await readJson<Hit[]>(await app.request('/api/search?q=closet'))
  assert.deepEqual(hits.map((h) => h.title), ['Ginger Jeans'])
})

test('search finds thread by colour and tools by name', async () => {
  const app = freshApp()
  await app.request('/api/threads', json({ name: 'Mara 120', colour: 'ecru', brand: 'Gütermann' }))
  await app.request('/api/tools', json({ name: 'Rotary cutter', category: 'cutting', brand: 'Olfa' }))

  const threadHits = await readJson<Hit[]>(await app.request('/api/search?q=ecru'))
  assert.equal(threadHits.length, 1)
  assert.equal(threadHits[0]!.type, 'thread')
  assert.match(threadHits[0]!.title, /ecru/)

  const toolHits = await readJson<Hit[]>(await app.request('/api/search?q=rotary'))
  assert.deepEqual(toolHits.map((h) => h.type), ['tool'])
})

test('a search query full of punctuation does not throw', async () => {
  const app = freshApp()
  await app.request('/api/fabrics', json({ name: 'Ticking stripe' }))
  const response = await app.request(`/api/search?q=${encodeURIComponent('"weird" * AND (')}`)
  assert.equal(response.status, 200)
})
