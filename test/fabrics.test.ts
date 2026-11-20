import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '../server/database'
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
    // Nothing costs anything yet, so the stash is worth no total at all.
    stashValue: [],
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

const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('a repurchase link must be http(s) at write time, not filtered at the click', async () => {
  const app = await freshApp()

  // Rendered as a link, so `javascript:` is refused before it is stored.
  const rejected = await app.request('/api/fabrics', json({ name: 'Sneaky', repurchaseUrl: 'javascript:alert(1)' }))
  assert.equal(rejected.status, 400)
  assert.equal((await readJson<unknown[]>(await app.request('/api/fabrics'))).length, 0)

  const stillRejected = await app.request('/api/fabrics', json({ name: 'Sneaky', repurchaseUrl: 'JAVASCRIPT:alert(1)' }))
  assert.equal(stillRejected.status, 400)

  const dataUrlRejected = await app.request('/api/fabrics', json({ name: 'Sneaky', repurchaseUrl: 'data:text/html,hi' }))
  assert.equal(dataUrlRejected.status, 400)

  // An ordinary shop link is fine, and round-trips.
  const created = await readJson<{ id: string; repurchaseUrl: string | null; artist: string | null }>(
    await app.request('/api/fabrics', json({ name: 'Linen', repurchaseUrl: 'https://example.com/linen', artist: 'Hannah Dale' })),
  )
  assert.equal(created.repurchaseUrl, 'https://example.com/linen')
  assert.equal(created.artist, 'Hannah Dale')

  // Clearing it is allowed, and an update carries both fields.
  const updated = await readJson<{ repurchaseUrl: string | null; artist: string | null }>(
    await app.request(`/api/fabrics/${created.id}`, put({ name: 'Linen', repurchaseUrl: null, artist: 'Hannah Dale' })),
  )
  assert.equal(updated.repurchaseUrl, null)
  assert.equal(updated.artist, 'Hannah Dale')
})

test('an artist is findable through search', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Meadow print', artist: 'Hannah Dale' }))

  const hits = await readJson<Array<{ type: string; title: string }>>(await app.request('/api/search?q=hannah'))
  assert.deepEqual(hits.map((hit) => [hit.type, hit.title]), [['fabric', 'Meadow print']])
})

test('the FTS rebuild keeps the fields it already indexed, and gains artist', async () => {
  const database = new DatabaseSync(':memory:')
  // The schema as it was before this migration, then a fabric in it.
  for (let index = 0; index < 9; index += 1) database.exec(MIGRATIONS[index]!)
  database
    .prepare(
      "INSERT INTO fabric (id, name, notes, created_at, updated_at) VALUES ('f1', 'Meadow print', 'a gift from mum', '2026-01-01', '2026-01-01')",
    )
    .run()

  for (let index = 9; index < MIGRATIONS.length; index += 1) database.exec(MIGRATIONS[index]!)

  // The new column is indexed.
  const byArtist = database.prepare(`SELECT rowid FROM fabric_fts WHERE fabric_fts MATCH '"hannah"*'`).get()
  assert.equal(byArtist, undefined, 'nothing indexed artist yet — now add one and let the trigger work')

  database
    .prepare("UPDATE fabric SET artist = 'Hannah Dale' WHERE id = 'f1'")
    .run()
  const artistHit = database.prepare(`SELECT rowid FROM fabric_fts WHERE fabric_fts MATCH '"hannah"*'`).get() as
    | { rowid: number }
    | undefined
  assert.ok(artistHit, 'the trigger indexes the new column')

  // And the old fields survived the rebuild.
  const notesHit = database.prepare(`SELECT rowid FROM fabric_fts WHERE fabric_fts MATCH '"gift"*'`).get() as
    | { rowid: number }
    | undefined
  assert.ok(notesHit, 'the pre-existing fields are still indexed')
})
