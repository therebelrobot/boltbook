import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '../server/database'
import { createZip, readZip } from '../server/zip'
import { freshApp, json, readJson, type Client } from './helpers'

interface FabricPhoto {
  id: string
  fabricId: string
  position: number
  contentType: string
  widthPx: number | null
  heightPx: number | null
  byteSize: number
}
interface Fabric {
  id: string
  photos: FabricPhoto[]
}

const PIXEL_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5])

const makeFabric = async (app: Client, body: Record<string, unknown> = {}) =>
  readJson<Fabric>(await app.request('/api/fabrics', json({ name: 'Linen', ...body })))

const upload = (app: Client, fabricId: string, bytes: Buffer, contentType = 'image/png', query = '') =>
  app.request(`/api/fabrics/${fabricId}/photos${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new Uint8Array(bytes),
  })

test('upload a photo and read it back', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)

  const created = await upload(app, fabric.id, PIXEL_BYTES, 'image/png', '?widthPx=1600&heightPx=1200')
  assert.equal(created.status, 201)
  const photo = await readJson<FabricPhoto>(created)
  assert.equal(photo.contentType, 'image/png')
  assert.equal(photo.position, 0)
  assert.equal(photo.widthPx, 1600)
  assert.equal(photo.heightPx, 1200)
  assert.equal(photo.byteSize, PIXEL_BYTES.byteLength)

  const reloaded = await readJson<Fabric>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.equal(reloaded.photos.length, 1)
  assert.equal(reloaded.photos[0]!.id, photo.id)
})

test('the bytes come back byte-for-byte with an immutable cache header', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const photo = await readJson<FabricPhoto>(await upload(app, fabric.id, PIXEL_BYTES))

  const response = await app.request(`/api/fabrics/${fabric.id}/photos/${photo.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.match(response.headers.get('cache-control') ?? '', /immutable/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PIXEL_BYTES)
})

test('a second photo takes the next position', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  await upload(app, fabric.id, PIXEL_BYTES)
  const second = await readJson<FabricPhoto>(await upload(app, fabric.id, PIXEL_BYTES, 'image/jpeg'))
  assert.equal(second.position, 1)

  const reloaded = await readJson<Fabric>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.deepEqual(reloaded.photos.map((p) => p.position), [0, 1])
})

test('a non-image upload is refused', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const response = await upload(app, fabric.id, Buffer.from('not an image'), 'application/pdf')
  assert.equal(response.status, 400)
  assert.equal((await readJson<{ error: string }>(response)).error, 'invalid_request')
})

test('an empty upload is refused', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  assert.equal((await upload(app, fabric.id, Buffer.alloc(0))).status, 400)
})

test('uploading to a missing fabric is a 404', async () => {
  const app = await freshApp()
  assert.equal((await upload(app, 'ghost', PIXEL_BYTES)).status, 404)
})

test('a photo is not served under another fabric', async () => {
  const app = await freshApp()
  const one = await makeFabric(app, { name: 'One' })
  const two = await makeFabric(app, { name: 'Two' })
  const photo = await readJson<FabricPhoto>(await upload(app, one.id, PIXEL_BYTES))
  assert.equal((await app.request(`/api/fabrics/${two.id}/photos/${photo.id}`)).status, 404)
})

test('delete a photo', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const photo = await readJson<FabricPhoto>(await upload(app, fabric.id, PIXEL_BYTES))

  assert.equal((await app.request(`/api/fabrics/${fabric.id}/photos/${photo.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/fabrics/${fabric.id}/photos/${photo.id}`)).status, 404)
  const reloaded = await readJson<Fabric>(await app.request(`/api/fabrics/${fabric.id}`))
  assert.deepEqual(reloaded.photos, [])
})

test('deleting the fabric cascades to its photos', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  const photo = await readJson<FabricPhoto>(await upload(app, fabric.id, PIXEL_BYTES))
  assert.equal((await app.request(`/api/fabrics/${fabric.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/fabrics/${fabric.id}/photos/${photo.id}`)).status, 404)
})

test('bad dimension query values are refused', async () => {
  const app = await freshApp()
  const fabric = await makeFabric(app)
  assert.equal((await upload(app, fabric.id, PIXEL_BYTES, 'image/png', '?widthPx=wide')).status, 400)
})

test('the CSP allows blob: images, which the pending-photo preview needs', async () => {
  const app = await freshApp()
  const policy = (await app.request('/api/status')).headers.get('content-security-policy') ?? ''
  // Before upload a preview is a blob URL; without blob: in img-src the browser
  // blocks it inline and the preview silently never appears — while the same
  // blob URL still opens fine in a new tab, because navigation is not img-src.
  const imageSource = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('img-src'))
  assert.ok(imageSource, 'no img-src in the policy')
  assert.match(imageSource, /blob:/)
})

// ---------- photos on every record ----------

const uploadGeneric = (app: Client, entityType: string, entityId: string, bytes: Buffer, contentType = 'image/png') =>
  app.request(`/api/photos/${entityType}/${entityId}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new Uint8Array(bytes),
  })

/** One record of each kind, created through its ordinary route. */
const makers: Record<string, (app: Client) => Promise<string>> = {
  fabric: async (app) => (await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Linen' })))).id,
  thread: async (app) => (await readJson<{ id: string }>(await app.request('/api/threads', json({ name: 'Mara 120' })))).id,
  notion: async (app) => (await readJson<{ id: string }>(await app.request('/api/notions', json({ name: 'Metal zip' })))).id,
  tool: async (app) => (await readJson<{ id: string }>(await app.request('/api/tools', json({ name: 'Rotary cutter' })))).id,
  pattern: async (app) => (await readJson<{ id: string }>(await app.request('/api/patterns', json({ name: 'Archer' })))).id,
  project: async (app) => (await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Shirt' })))).id,
}

for (const kind of Object.keys(makers)) {
  test(`a ${kind} can hold a photo and cascade it on delete`, async () => {
    const app = await freshApp()
    const id = await makers[kind]!(app)

    const created = await uploadGeneric(app, kind, id, PIXEL_BYTES, 'image/png', )
    assert.equal(created.status, 201)
    const photo = await readJson<{ id: string; entityType: string; entityId: string; position: number }>(created)
    assert.equal(photo.entityType, kind)
    assert.equal(photo.entityId, id)
    assert.equal(photo.position, 0)

    // The record carries the metadata; the bytes come back through the generic route.
    const listPath = ({
      fabric: '/api/fabrics',
      thread: '/api/threads',
      notion: '/api/notions',
      tool: '/api/tools',
      pattern: '/api/patterns',
      project: '/api/projects',
    } as Record<string, string>)[kind]
    const [record] = await readJson<Array<{ photos: Array<{ id: string }> }>>(await app.request(listPath!))
    assert.equal(record!.photos[0]!.id, photo.id)
    const bytes = await app.request(`/api/photos/${kind}/${id}/${photo.id}`)
    assert.equal(bytes.status, 200)
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), PIXEL_BYTES)

    // The record's own delete takes its photos with it.
    await app.request(`${listPath}/${id}`, { method: 'DELETE' })
    assert.equal((await app.request(`/api/photos/${kind}/${id}/${photo.id}`)).status, 404)
  })
}

test('a photo is not served under another record of the same kind', async () => {
  const app = await freshApp()
  const one = await makers.notion!(app)
  const two = await makers.notion!(app)
  const photo = await readJson<{ id: string }>(await uploadGeneric(app, 'notion', one, PIXEL_BYTES))
  assert.equal((await app.request(`/api/photos/notion/${two}/${photo.id}`)).status, 404)
})

test('an unknown record kind is refused, not guessed at', async () => {
  const app = await freshApp()
  const id = await makers.notion!(app)
  assert.equal((await uploadGeneric(app, 'garment', id, PIXEL_BYTES)).status, 404)
  assert.equal((await app.request(`/api/photos/garment/${id}/anything`)).status, 404)
})

test('uploading to a missing parent is a 404 for every kind', async () => {
  const app = await freshApp()
  for (const kind of Object.keys(makers)) {
    assert.equal((await uploadGeneric(app, kind, 'ghost', PIXEL_BYTES)).status, 404)
  }
})

test('a notion photo round-trips through export and import', async () => {
  const source = await freshApp()
  const notionId = await makers.notion!(source)
  const photo = await readJson<{ id: string }>(await uploadGeneric(source, 'notion', notionId, PIXEL_BYTES))
  const zip = Buffer.from(await (await source.request('/api/export')).arrayBuffer())

  const target = await freshApp()
  const response = await target.request('/api/import?mode=replace', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(zip),
  })
  assert.equal(response.status, 200)

  const restored = await target.request(`/api/photos/notion/${notionId}/${photo.id}`)
  assert.equal(restored.status, 200)
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), PIXEL_BYTES)
  const [record] = await readJson<Array<{ photos: Array<{ id: string }> }>>(await target.request('/api/notions'))
  assert.equal(record!.photos[0]!.id, photo.id)
})

test('an export from before the shared photo table still restores', async () => {
  // Take a current export and wind its JSON back to the fabric_photo shape.
  const source = await freshApp()
  const fabric = await readJson<{ id: string }>(await source.request('/api/fabrics', json({ name: 'Linen' })))
  const photo = await readJson<{ id: string }>(await uploadGeneric(source, 'fabric', fabric.id, PIXEL_BYTES))
  const zip = Buffer.from(await (await source.request('/api/export')).arrayBuffer())

  const entries = readZip(zip)
  const manifest = JSON.parse(entries.get('boltbook.json')!.toString('utf8')) as {
    tables: Record<string, Array<Record<string, unknown>>>
  }
  const legacy = manifest.tables.photo!.map(({ entity_type: _e, entity_id: _i, ...row }) => ({ ...row, fabric_id: _i }))
  const tables: Record<string, Array<Record<string, unknown>>> = { ...manifest.tables, fabric_photo: legacy }
  delete tables.photo
  const rewritten = createZip(
    [
      { name: 'boltbook.json', data: Buffer.from(JSON.stringify({ ...manifest, tables }, null, 2), 'utf8') },
      { name: `photos/${photo.id}.png`, data: PIXEL_BYTES },
    ],
    new Date(),
  )

  const target = await freshApp()
  const response = await target.request('/api/import?mode=replace', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(rewritten),
  })
  assert.equal(response.status, 200)

  const restored = await target.request(`/api/photos/fabric/${fabric.id}/${photo.id}`)
  assert.equal(restored.status, 200)
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), PIXEL_BYTES)
})

test('the migration copies fabric photos byte-for-byte and retires the old table', () => {
  const database = new DatabaseSync(':memory:')
  // The schema as it was before this migration (indices 0..7), then a photo in it.
  for (let index = 0; index < 8; index += 1) database.exec(MIGRATIONS[index]!)
  database
    .prepare("INSERT INTO fabric (id, name, created_at, updated_at) VALUES ('f1', 'Linen', '2026-01-01', '2026-01-01')")
    .run()
  const bytes = Buffer.from([9, 8, 7, 6, 5])
  database
    .prepare(
      `INSERT INTO fabric_photo (id, fabric_id, position, content_type, bytes, width_px, height_px, created_at)
       VALUES ('p1', 'f1', 0, 'image/png', ?, 10, 20, '2026-01-02')`,
    )
    .run(new Uint8Array(bytes))

  for (let index = 8; index < MIGRATIONS.length; index += 1) database.exec(MIGRATIONS[index]!)

  const row = database.prepare("SELECT entity_type, entity_id, bytes FROM photo WHERE id = 'p1'").get() as {
    entity_type: string
    entity_id: string
    bytes: Uint8Array
  }
  assert.equal(row.entity_type, 'fabric')
  assert.equal(row.entity_id, 'f1')
  assert.deepEqual(Buffer.from(row.bytes), bytes)
  const count = database.prepare('SELECT COUNT(*) AS n FROM photo').get() as { n: number }
  assert.equal(count.n, 1)
  assert.throws(() => database.prepare('SELECT * FROM fabric_photo').all())
})
