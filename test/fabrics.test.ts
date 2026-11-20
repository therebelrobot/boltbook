import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '../server/database'
import { fabricWithCut, freshApp, json, put, readJson } from './helpers'

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

test('a fabric is born with one empty cut, and the cut carries the lengths', async () => {
  const app = await freshApp()
  const created = await app.request(
    '/api/fabrics',
    json({ name: 'Washed linen', fibre: 'linen', location: 'Bin A' }),
  )
  assert.equal(created.status, 201)
  const fabric = await readJson<{ id: string; name: string; cuts: Array<{ id: string; lengthMm: number | null }> }>(created)
  assert.equal(fabric.name, 'Washed linen')
  assert.equal(fabric.cuts.length, 1)
  assert.equal(fabric.cuts[0]!.lengthMm, null)

  // The piece is measured later, on the cut.
  const cut = await readJson<{ lengthMm: number | null; originalLengthMm: number | null }>(
    await app.request(`/api/fabrics/${fabric.id}/cuts/${fabric.cuts[0]!.id}`, put({ lengthMm: 3000, originalLengthMm: 3000 })),
  )
  assert.equal(cut.lengthMm, 3000)
  assert.equal(cut.originalLengthMm, 3000)

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

test('a cut cannot keep more than it was bought as', async () => {
  const app = await freshApp()
  const fabric = await fabricWithCut(app, { name: 'Odd bolt' })
  const response = await app.request(`/api/fabrics/${fabric.id}/cuts/${fabric.cutId}`, {
    ...put({ lengthMm: 5000, originalLengthMm: 3000 }),
  })
  assert.equal(response.status, 400)
})

test('replace changes fields and keeps identity', async () => {
  const app = await freshApp()
  const fabric = await fabricWithCut(app, { name: 'Poplin' }, { lengthMm: 2000 })
  const updated = await app.request(
    `/api/fabrics/${fabric.id}`,
    {
      ...put({ name: 'Poplin', fibre: 'cotton' }),
    },
  )
  assert.equal(updated.status, 200)
  const body = await readJson<{ id: string; fibre: string; cuts: Array<{ lengthMm: number | null }> }>(updated)
  assert.equal(body.id, fabric.id)
  assert.equal(body.fibre, 'cotton')
  // The cloth edit does not touch the piece: the length is the cut's.
  assert.equal(body.cuts[0]!.lengthMm, 2000)
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

test('filters narrow by fibre and by the sum of the cuts', async () => {
  const app = await freshApp()
  await fabricWithCut(app, { name: 'Linen', fibre: 'linen' }, { lengthMm: 3000 })
  await fabricWithCut(app, { name: 'Cotton', fibre: 'cotton' }, { lengthMm: 500 })

  const linen = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?fibre=linen'))
  assert.deepEqual(linen.map((f) => f.name), ['Linen'])

  const longEnough = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?minLengthMm=1000'))
  assert.deepEqual(longEnough.map((f) => f.name), ['Linen'])
})

test('two cuts report their sum, and the filter reads the sum', async () => {
  const app = await freshApp()
  const fabric = await fabricWithCut(app, { name: 'Linen' }, { lengthMm: 3000, originalLengthMm: 3000 })
  const second = await readJson<{ id: string; lengthMm: number | null }>(
    await app.request(`/api/fabrics/${fabric.id}/cuts`, json({ lengthMm: 2000 })),
  )

  const fetched = await readJson<{ cuts: Array<{ id: string; lengthMm: number | null }> }>(
    await app.request(`/api/fabrics/${fabric.id}`),
  )
  assert.deepEqual(fetched.cuts.map((cut) => cut.lengthMm), [3000, 2000])
  assert.notEqual(second.id, fabric.cutId)

  // The whole stash of this cloth is five metres, not three.
  const longEnough = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?minLengthMm=5000'))
  assert.deepEqual(longEnough.map((f) => f.name), ['Linen'])
  const tooLong = await readJson<Array<{ name: string }>>(await app.request('/api/fabrics?minLengthMm=5001'))
  assert.deepEqual(tooLong, [])
})

test('the last cut cannot be deleted; the fabric keeps at least one piece', async () => {
  const app = await freshApp()
  const fabric = await fabricWithCut(app, { name: 'Linen' }, { lengthMm: 2000 })
  const response = await app.request(`/api/fabrics/${fabric.id}/cuts/${fabric.cutId}`, { method: 'DELETE' })
  assert.equal(response.status, 409)

  // With a second cut, removing one is fine.
  await app.request(`/api/fabrics/${fabric.id}/cuts`, json({ lengthMm: 1000 }))
  const after = await readJson<{ cuts: Array<{ id: string }> }>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.equal((await app.request(`/api/fabrics/${fabric.id}/cuts/${after.cuts[1]!.id}`, { method: 'DELETE' })).status, 200)
  const final = await readJson<{ cuts: Array<{ lengthMm: number | null }> }>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.deepEqual(final.cuts.map((cut) => cut.lengthMm), [2000])
})

test('consuming decrements only the cut that was named', async () => {
  const app = await freshApp()
  const fabric = await fabricWithCut(app, { name: 'Linen' }, { lengthMm: 3000 })
  const second = await readJson<{ id: string }>(await app.request(`/api/fabrics/${fabric.id}/cuts`, json({ lengthMm: 2000 })))

  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt', status: 'planned' })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    ...put({ fabrics: [{ cutId: fabric.cutId, lengthMmUsed: 2500 }] }),
  })
  // Reaching done consumes what was allocated — from the named cut only.
  await app.request(`/api/projects/${project.id}`, put({ title: 'Shirt', status: 'done' }))

  const fetched = await readJson<{ cuts: Array<{ lengthMm: number | null }> }>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.deepEqual(fetched.cuts.map((cut) => cut.lengthMm), [500, 2000])
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

test('the cuts migration backfills one piece per fabric and repoints the allocations', () => {
  const database = new DatabaseSync(':memory:')
  // The schema as it was before this migration, with a v1-shaped stash:
  // fabrics carrying their own lengths and prices, and a project allocating one.
  for (let index = 0; index < 11; index += 1) database.exec(MIGRATIONS[index]!)
  database
    .prepare(
      `INSERT INTO fabric (id, name, length_mm, original_length_mm, cost_minor, currency, acquired_on, created_at, updated_at)
       VALUES ('f1', 'Linen', 2500, 3000, 4500, 'USD', '2026-01-01', '2026-01-01', '2026-01-01')`,
    )
    .run()
  database
    .prepare("INSERT INTO fabric (id, name, created_at, updated_at) VALUES ('f2', 'Unmeasured', '2026-01-01', '2026-01-01')")
    .run()
  database
    .prepare("INSERT INTO project (id, title, status, consumed, created_at, updated_at) VALUES ('p1', 'Shirt', 'planned', 0, '2026-01-01', '2026-01-01')")
    .run()
  database
    .prepare("INSERT INTO project_fabric (project_id, fabric_id, length_mm_used) VALUES ('p1', 'f1', 2800)")
    .run()

  for (let index = 11; index < MIGRATIONS.length; index += 1) database.exec(MIGRATIONS[index]!)

  const cuts = database
    .prepare('SELECT id, fabric_id, length_mm, original_length_mm, cost_minor, currency, acquired_on, position FROM fabric_cut ORDER BY fabric_id')
    .all() as Array<Record<string, unknown>>
  // One cut per fabric, values intact, and the unmeasured fabric still gets its piece.
  assert.deepEqual(cuts.map((cut) => [cut.fabric_id, cut.length_mm, cut.position]), [
    ['f1', 2500, 0],
    ['f2', null, 0],
  ])
  const backfilled = cuts.find((cut) => cut.fabric_id === 'f1')!
  assert.equal(backfilled.original_length_mm, 3000)
  assert.equal(backfilled.cost_minor, 4500)
  assert.equal(backfilled.currency, 'USD')
  assert.equal(backfilled.acquired_on, '2026-01-01')

  // The allocation names the cut now, and points at the cut its fabric became.
  const allocations = database
    .prepare(
      `SELECT fc.fabric_id AS fabric_id, pc.cut_id AS cut_id, pc.length_mm_used AS length_mm_used
         FROM project_cut pc JOIN fabric_cut fc ON fc.id = pc.cut_id`,
    )
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }))
  assert.deepEqual(allocations, [{ fabric_id: 'f1', cut_id: backfilled.id, length_mm_used: 2800 }])

  // And the fabric no longer carries a second copy of the numbers.
  assert.throws(() => database.prepare('SELECT length_mm FROM fabric').all())
})
