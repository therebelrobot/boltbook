import test from 'node:test'
import assert from 'node:assert/strict'
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
