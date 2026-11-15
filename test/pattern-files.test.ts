import test from 'node:test'
import assert from 'node:assert/strict'
import { freshApp, json, readJson, type Client } from './helpers'

interface PatternFile {
  id: string
  patternId: string
  filename: string
  contentType: string
  pageCount: number | null
  byteSize: number
  thumbnail: { contentType: string; widthPx: number | null; heightPx: number | null } | null
}

interface Pattern {
  id: string
  name: string
  file: PatternFile | null
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const THUMBNAIL_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const makePattern = async (app: Client, body: Record<string, unknown> = {}): Promise<Pattern> =>
  readJson<Pattern>(await app.request('/api/patterns', json({ name: 'Archer', ...body })))

const uploadFile = (app: Client, patternId: string, bytes: Buffer = PDF_BYTES, query = '?pageCount=12') =>
  app.request(`/api/patterns/${patternId}/file${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: new Uint8Array(bytes),
  })

const uploadThumbnail = (app: Client, patternId: string, fileId: string, bytes = THUMBNAIL_BYTES, query = '?widthPx=360&heightPx=480') =>
  app.request(`/api/patterns/${patternId}/file/${fileId}/thumbnail${query}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(bytes),
  })

test('upload a pattern PDF and read it back', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)

  const created = await uploadFile(app, pattern.id, PDF_BYTES, '?pageCount=12&filename=Archer%20A0.pdf')
  assert.equal(created.status, 201)
  const file = await readJson<PatternFile>(created)
  assert.equal(file.patternId, pattern.id)
  assert.equal(file.filename, 'Archer A0.pdf')
  assert.equal(file.contentType, 'application/pdf')
  assert.equal(file.pageCount, 12)
  assert.equal(file.byteSize, PDF_BYTES.byteLength)
  assert.equal(file.thumbnail, null)

  const reloaded = await readJson<Pattern>(await app.request(`/api/patterns/${pattern.id}`))
  assert.equal(reloaded.file?.id, file.id)
  assert.equal(reloaded.file?.pageCount, 12)
  // The list carries metadata, never the bytes.
  assert.equal(JSON.stringify(reloaded).includes('%PDF'), false)
})

test('the PDF comes back byte-for-byte, inline, with an immutable private cache', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  const file = await readJson<PatternFile>(await uploadFile(app, pattern.id))

  const response = await app.request(`/api/patterns/${pattern.id}/file/${file.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') ?? '', /^inline; filename="pattern\.pdf"/)
  assert.match(response.headers.get('cache-control') ?? '', /private/)
  assert.match(response.headers.get('cache-control') ?? '', /immutable/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF_BYTES)
})

test('a thumbnail is stored and served by file id', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  const file = await readJson<PatternFile>(await uploadFile(app, pattern.id))

  const response = await uploadThumbnail(app, pattern.id, file.id)
  assert.equal(response.status, 201)
  const withThumbnail = await readJson<PatternFile>(response)
  assert.deepEqual(withThumbnail.thumbnail, { contentType: 'image/png', widthPx: 360, heightPx: 480 })

  const thumbnail = await app.request(`/api/patterns/${pattern.id}/file/${file.id}/thumbnail`)
  assert.equal(thumbnail.status, 200)
  assert.equal(thumbnail.headers.get('content-type'), 'image/png')
  assert.match(thumbnail.headers.get('cache-control') ?? '', /immutable/)
  assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), THUMBNAIL_BYTES)
})

test('replacing the file changes its id, so the old URL never serves stale bytes', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  const first = await readJson<PatternFile>(await uploadFile(app, pattern.id))
  await uploadThumbnail(app, pattern.id, first.id)

  const replacement = Buffer.from('%PDF-1.7\n% a different pattern\n%%EOF\n')
  const second = await readJson<PatternFile>(await uploadFile(app, pattern.id, replacement, '?pageCount=3'))

  assert.notEqual(second.id, first.id)
  assert.equal(second.pageCount, 3)
  assert.equal((await app.request(`/api/patterns/${pattern.id}/file/${first.id}`)).status, 404)
  assert.equal((await app.request(`/api/patterns/${pattern.id}/file/${first.id}/thumbnail`)).status, 404)

  const current = await app.request(`/api/patterns/${pattern.id}/file/${second.id}`)
  assert.deepEqual(Buffer.from(await current.arrayBuffer()), replacement)
})

test('the filename is a label, not a path', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  const file = await readJson<PatternFile>(
    await uploadFile(app, pattern.id, PDF_BYTES, `?filename=${encodeURIComponent('../../etc/secrets.pdf')}`),
  )
  assert.equal(file.filename, 'secrets.pdf')

  const response = await app.request(`/api/patterns/${pattern.id}/file/${file.id}`)
  assert.match(response.headers.get('content-disposition') ?? '', /filename="secrets\.pdf"/)
})

test('only a PDF is accepted, and only a JPEG or PNG thumbnail', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)

  const wrongType = await app.request(`/api/patterns/${pattern.id}/file`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(PDF_BYTES),
  })
  assert.equal(wrongType.status, 400)

  const file = await readJson<PatternFile>(await uploadFile(app, pattern.id))
  const wrongThumbnail = await app.request(`/api/patterns/${pattern.id}/file/${file.id}/thumbnail`, {
    method: 'POST',
    headers: { 'content-type': 'image/gif' },
    body: new Uint8Array(THUMBNAIL_BYTES),
  })
  assert.equal(wrongThumbnail.status, 400)
})

test('an empty PDF is refused', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  assert.equal((await uploadFile(app, pattern.id, Buffer.alloc(0))).status, 400)
})

test('a bad page count is refused', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  assert.equal((await uploadFile(app, pattern.id, PDF_BYTES, '?pageCount=lots')).status, 400)
})

test('uploading to a missing pattern is a 404', async () => {
  const app = await freshApp()
  assert.equal((await uploadFile(app, 'ghost')).status, 404)
})

test('a file is not served under another pattern', async () => {
  const app = await freshApp()
  const one = await makePattern(app, { name: 'One' })
  const two = await makePattern(app, { name: 'Two' })
  const file = await readJson<PatternFile>(await uploadFile(app, one.id))
  assert.equal((await app.request(`/api/patterns/${two.id}/file/${file.id}`)).status, 404)
})

test('delete the file, and deleting the pattern cascades', async () => {
  const app = await freshApp()
  const pattern = await makePattern(app)
  const file = await readJson<PatternFile>(await uploadFile(app, pattern.id))

  assert.equal((await app.request(`/api/patterns/${pattern.id}/file`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/patterns/${pattern.id}/file/${file.id}`)).status, 404)
  const reloaded = await readJson<Pattern>(await app.request(`/api/patterns/${pattern.id}`))
  assert.equal(reloaded.file, null)

  const second = await readJson<PatternFile>(await uploadFile(app, pattern.id))
  assert.equal((await app.request(`/api/patterns/${pattern.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.request(`/api/patterns/${pattern.id}/file/${second.id}`)).status, 404)
})
