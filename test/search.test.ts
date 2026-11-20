import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '../server/database'
import { freshApp, json, readJson } from './helpers'
import { buildMatchQuery } from '../server/repositories/search'

interface Hit {
  type: 'fabric' | 'pattern' | 'thread' | 'tool' | 'notion' | 'project'
  id: string
  title: string
  snippet: string | null
}

test('buildMatchQuery quotes every term as a prefix', () => {
  assert.equal(buildMatchQuery('washed linen'), '"washed"* AND "linen"*')
  assert.equal(buildMatchQuery('  '), null)
})

test('search finds a fabric by a field and by a prefix', async () => {
  const app = await freshApp()
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
  const app = await freshApp()
  await app.request('/api/patterns', json({ name: 'Archer Button-Up', brand: 'Grainline', category: 'shirts' }))
  await app.request('/api/fabrics', json({ name: 'Shirting cotton', fibre: 'cotton' }))

  const hits = await readJson<Hit[]>(await app.request('/api/search?q=shirt'))
  const types = new Set(hits.map((h) => h.type))
  assert.deepEqual(hits.map((h) => h.title).sort(), ['Archer Button-Up', 'Shirting cotton'])
  assert.deepEqual([...types].sort(), ['fabric', 'pattern'])
})

test('search finds a pattern by its brand', async () => {
  const app = await freshApp()
  await app.request('/api/patterns', json({ name: 'Ginger Jeans', brand: 'Closet Core' }))
  const hits = await readJson<Hit[]>(await app.request('/api/search?q=closet'))
  assert.deepEqual(hits.map((h) => h.title), ['Ginger Jeans'])
})

test('search finds thread by colour and tools by name', async () => {
  const app = await freshApp()
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
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Ticking stripe' }))
  const response = await app.request(`/api/search?q=${encodeURIComponent('"weird" * AND (')}`)
  assert.equal(response.status, 200)
})

test('search finds a notion by its own fields', async () => {
  const app = await freshApp()
  await app.request('/api/notions', json({ name: 'Metal zip 20 cm', colour: 'brass', spec: '20 cm, brass teeth', notes: 'for the jeans' }))
  await app.request('/api/notions', json({ name: 'Corozo buttons', colour: 'cream' }))

  // The brass 20 cm zip: findable by the word in its spec, not only by scrolling.
  const bySpec = await readJson<Hit[]>(await app.request('/api/search?q=teeth'))
  assert.deepEqual(bySpec.map((h) => [h.type, h.title]), [['notion', 'Metal zip 20 cm — brass']])

  const byColour = await readJson<Hit[]>(await app.request('/api/search?q=cream'))
  assert.deepEqual(byColour.map((h) => h.type), ['notion'])

  // And by a prefix of its name.
  const byPrefix = await readJson<Hit[]>(await app.request('/api/search?q=zip'))
  assert.deepEqual(byPrefix.map((h) => h.type), ['notion'])
})

test('a project turns up in search — after the stash, not beside it', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen shift cloth', fibre: 'linen' }))
  await app.request('/api/projects', json({ title: 'Linen shift', notes: 'the Archer shirt made in linen' }))

  const hits = await readJson<Hit[]>(await app.request('/api/search?q=linen'))
  // What you have first; what you did, last and labelled.
  assert.deepEqual(hits.map((h) => h.type), ['fabric', 'project'])
  assert.equal(hits[1]!.title, 'Linen shift')
  assert.match(hits[1]!.snippet ?? '', /[Ll]inen/)
})

test('a notion and a project turn up through a tag alone', async () => {
  const app = await freshApp()
  await app.request('/api/notions', json({ name: 'Plain buttons', tags: ['shirt'] }))
  await app.request('/api/projects', json({ title: 'Undone hemming', tags: ['shirt'] }))

  // Nothing in their fields says "shirt"; the tag does.
  const hits = await readJson<Hit[]>(await app.request('/api/search?q=shirt'))
  assert.deepEqual(
    hits.map((h) => [h.type, h.snippet]),
    [
      ['notion', 'tags: shirt'],
      ['project', 'tags: shirt'],
    ],
  )
})

test('search stays under the one-second bar at 100+ records', async () => {
  const app = await freshApp()
  for (let index = 0; index < 110; index += 1) {
    await app.request('/api/fabrics', json({ name: `Cloth ${index}`, fibre: 'cotton', notes: 'a note' }))
  }
  for (let index = 0; index < 40; index += 1) {
    await app.request('/api/notions', json({ name: `Zip ${index}`, spec: '20 cm' }))
  }

  const started = performance.now()
  const response = await app.request('/api/search?q=cloth')
  const elapsed = performance.now() - started
  assert.equal(response.status, 200)
  assert.ok(elapsed < 1000, `search took ${Math.round(elapsed)} ms; the bar is one second`)
})

test('notions and projects recorded before the migration are indexed by it', () => {
  const database = new DatabaseSync(':memory:')
  // The schema as it was before migration 10, then a notion and a project in it.
  for (let index = 0; index < 9; index += 1) database.exec(MIGRATIONS[index]!)
  database
    .prepare("INSERT INTO notion (id, name, colour, spec, created_at, updated_at) VALUES ('n1', 'Metal zip', 'brass', '20 cm', '2026-01-01', '2026-01-01')")
    .run()
  database
    .prepare("INSERT INTO project (id, title, status, consumed, created_at, updated_at) VALUES ('p1', 'Archer shirt', 'planned', 0, '2026-01-01', '2026-01-01')")
    .run()

  for (let index = 9; index < MIGRATIONS.length; index += 1) database.exec(MIGRATIONS[index]!)

  const notionHit = database
    .prepare(`SELECT rowid FROM notion_fts WHERE notion_fts MATCH '"brass"*'`)
    .get() as { rowid: number } | undefined
  assert.ok(notionHit, 'the pre-existing notion is in the index')
  const projectHit = database
    .prepare(`SELECT rowid FROM project_fts WHERE project_fts MATCH '"archer"*'`)
    .get() as { rowid: number } | undefined
  assert.ok(projectHit, 'the pre-existing project is in the index')
})
