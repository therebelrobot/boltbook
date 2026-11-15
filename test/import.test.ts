import test from 'node:test'
import assert from 'node:assert/strict'
import { anonymousApp, freshApp, json, readJson, type Client } from './helpers'

const PIXELS = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7])
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const THUMBNAIL_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6])

const exportZip = async (app: Client): Promise<Buffer> =>
  Buffer.from(await (await app.request('/api/export')).arrayBuffer())

const restore = (app: Client, zip: Buffer, query = '?mode=replace') =>
  app.request(`/api/import${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(zip),
  })

/** A source instance with one of everything, including a photo and a pattern PDF. */
async function seedSource(): Promise<{
  app: Client
  zip: Buffer
  photoId: string
  fabricId: string
  patternId: string
  patternFileId: string
}> {
  const app = await freshApp()
  const fabric = await readJson<{ id: string }>(
    await app.request('/api/fabrics', json({ name: 'Washed linen', fibre: 'linen', lengthMm: 2500, widthMm: 1400, tags: ['linen', 'summer'] })),
  )
  const photo = await readJson<{ id: string }>(
    await app.request(`/api/fabrics/${fabric.id}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(PIXELS),
    }),
  )
  const pattern = await readJson<{ id: string }>(await app.request('/api/patterns', json({ name: 'Archer', brand: 'Grainline', tags: ['shirt'] })))
  const patternFile = await readJson<{ id: string }>(
    await app.request(`/api/patterns/${pattern.id}/file?pageCount=4&filename=Archer.pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array(PDF_BYTES),
    }),
  )
  await app.request(`/api/patterns/${pattern.id}/file/${patternFile.id}/thumbnail?widthPx=360&heightPx=480`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(THUMBNAIL_BYTES),
  })
  const view = await readJson<{ id: string }>(await app.request(`/api/patterns/${pattern.id}/views`, json({ label: 'A' })))
  await app.request(`/api/patterns/${pattern.id}/views/${view.id}/requirements`, json({ role: 'main', lengthMm: 1800, fabricWidthMm: 1400 }))
  const project = await readJson<{ id: string }>(await app.request('/api/projects', json({ title: 'Archer shirt', status: 'cutting', tags: ['shirt'] })))
  await app.request(`/api/projects/${project.id}/allocations`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fabrics: [{ fabricId: fabric.id, lengthMmUsed: 2800 }] }),
  })
  return {
    app,
    zip: await exportZip(app),
    photoId: photo.id,
    fabricId: fabric.id,
    patternId: pattern.id,
    patternFileId: patternFile.id,
  }
}

test('a restore reproduces the records, the tags, the views and the photo bytes', async () => {
  const source = await seedSource()
  const target = await freshApp()

  const response = await restore(target, source.zip)
  assert.equal(response.status, 200)
  const result = await readJson<{ ok: boolean; photos: number; patternFiles: number; imported: Record<string, number> }>(response)
  assert.equal(result.ok, true)
  assert.equal(result.photos, 1)
  assert.equal(result.patternFiles, 1)
  assert.equal(result.imported.fabric, 1)
  assert.equal(result.imported.pattern_file, 1)
  assert.equal(result.imported.tag, 3)
  assert.equal(result.imported.tag_link, 4)

  const fabrics = await readJson<Array<{ name: string; lengthMm: number; tags: string[]; photos: Array<{ id: string }> }>>(
    await target.request('/api/fabrics'),
  )
  assert.equal(fabrics.length, 1)
  assert.equal(fabrics[0]!.name, 'Washed linen')
  assert.equal(fabrics[0]!.lengthMm, 2500)
  assert.deepEqual(fabrics[0]!.tags, ['linen', 'summer'])
  assert.equal(fabrics[0]!.photos[0]!.id, source.photoId)

  // The photo's bytes came back byte-for-byte, from the zip entry.
  const photo = await target.request(`/api/fabrics/${source.fabricId}/photos/${source.photoId}`)
  assert.equal(photo.status, 200)
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PIXELS)

  const [pattern] = await readJson<
    Array<{
      file: { id: string; filename: string; pageCount: number | null; thumbnail: { contentType: string } | null } | null
      views: Array<{ label: string; requirements: Array<{ role: string; lengthMm: number | null }> }>
    }>
  >(await target.request('/api/patterns'))
  assert.equal(pattern!.views[0]!.label, 'A')
  assert.equal(pattern!.views[0]!.requirements[0]!.lengthMm, 1800)
  assert.equal(pattern!.file?.id, source.patternFileId)
  assert.equal(pattern!.file?.filename, 'Archer.pdf')
  assert.equal(pattern!.file?.pageCount, 4)
  assert.equal(pattern!.file?.thumbnail?.contentType, 'image/png')

  // The PDF and its thumbnail came back byte-for-byte from their zip entries.
  const restoredFile = await target.request(`/api/patterns/${source.patternId}/file/${source.patternFileId}`)
  assert.equal(restoredFile.status, 200)
  assert.deepEqual(Buffer.from(await restoredFile.arrayBuffer()), PDF_BYTES)
  const restoredThumbnail = await target.request(
    `/api/patterns/${source.patternId}/file/${source.patternFileId}/thumbnail`,
  )
  assert.equal(restoredThumbnail.status, 200)
  assert.deepEqual(Buffer.from(await restoredThumbnail.arrayBuffer()), THUMBNAIL_BYTES)

  const project = await readJson<Array<{ title: string; allocations: { fabrics: unknown[] } }>>(await target.request('/api/projects'))
  assert.equal(project[0]!.title, 'Archer shirt')
  assert.equal(project[0]!.allocations.fabrics.length, 1)

  // Search works on the restored data, including the FTS indexes rebuilt by triggers.
  const hits = await readJson<Array<{ title: string }>>(await target.request('/api/search?q=linen'))
  assert.ok(hits.some((hit) => hit.title === 'Washed linen'))
})

test('a restore replaces what was already there', async () => {
  const source = await seedSource()
  const target = await freshApp()
  await target.request('/api/fabrics', json({ name: 'Should disappear', lengthMm: 1000 }))
  assert.equal((await readJson<unknown[]>(await target.request('/api/fabrics'))).length, 1)

  await restore(target, source.zip)
  const fabrics = await readJson<Array<{ name: string }>>(await target.request('/api/fabrics'))
  assert.deepEqual(fabrics.map((fabric) => fabric.name), ['Washed linen'])
})

test('a restore must be asked for by name', async () => {
  const source = await seedSource()
  const target = await freshApp()
  await target.request('/api/fabrics', json({ name: 'Safe', lengthMm: 1000 }))

  const response = await restore(target, source.zip, '')
  assert.equal(response.status, 400)
  assert.match((await readJson<{ message: string }>(response)).message, /mode=replace/)
  // And nothing was touched.
  assert.deepEqual((await readJson<Array<{ name: string }>>(await target.request('/api/fabrics'))).map((f) => f.name), ['Safe'])
})

test('something that is not an export is refused, and changes nothing', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Safe', lengthMm: 1000 }))

  assert.equal((await restore(app, Buffer.from('not a zip at all'))).status, 400)

  const empty = await app.request('/api/import?mode=replace', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(),
  })
  assert.equal(empty.status, 400)

  assert.deepEqual((await readJson<Array<{ name: string }>>(await app.request('/api/fabrics'))).map((f) => f.name), ['Safe'])
})

test('a restore keeps this instance’s own audit log and records itself', async () => {
  const source = await seedSource()
  const target = await freshApp()
  await restore(target, source.zip)

  const entries = await readJson<Array<{ event: string }>>(await target.request('/api/audit'))
  const events = entries.map((entry) => entry.event)
  assert.ok(events.includes('imported'))
  // The source's history — including its exports — is not adopted.
  assert.equal(events.includes('exported'), false)
})

test('restoring needs a session', async () => {
  const source = await seedSource()
  const stranger = anonymousApp()
  assert.equal((await restore(stranger, source.zip)).status, 401)
})

test('a round trip through export and import is stable', async () => {
  const source = await seedSource()
  const target = await freshApp()
  await restore(target, source.zip)

  // Export the restored instance and restore that: the records match again.
  const again = await exportZip(target)
  const third = await freshApp()
  await restore(third, again)

  const sourceNames = (await readJson<Array<{ name: string }>>(await source.app.request('/api/fabrics'))).map((f) => f.name)
  const thirdNames = (await readJson<Array<{ name: string }>>(await third.request('/api/fabrics'))).map((f) => f.name)
  assert.deepEqual(thirdNames, sourceNames)
})
