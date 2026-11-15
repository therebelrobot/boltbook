import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { anonymousApp, freshApp, json, readJson } from './helpers'

/**
 * A small reader for the zip we write — enough to prove the archive is real and
 * to get the bytes back out, without adding a dependency to test a dependency.
 */
function listEntries(zip: Buffer): Array<{ name: string; method: number; size: number }> {
  let eocd = -1
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  assert.ok(eocd >= 0, 'no end-of-central-directory record')

  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  const entries: Array<{ name: string; method: number; size: number }> = []
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, 'bad central directory header')
    const method = zip.readUInt16LE(offset + 10)
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    entries.push({ name, method, size })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntry(zip: Buffer, wanted: string): Buffer | null {
  let offset = 0
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    if (name === wanted) {
      const data = zip.subarray(dataStart, dataStart + compressedSize)
      return method === 8 ? inflateRawSync(data) : Buffer.from(data)
    }
    offset = dataStart + compressedSize
  }
  return null
}

const exportZip = async (app: { request: (path: string, init?: RequestInit) => Promise<Response> }): Promise<Buffer> => {
  const response = await app.request('/api/export')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="boltbook-\d{4}-\d{2}-\d{2}\.zip"/)
  return Buffer.from(await response.arrayBuffer())
}

test('an empty instance still exports a valid zip', async () => {
  const app = await freshApp()
  const zip = await exportZip(app)
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'not a zip')
  assert.deepEqual(listEntries(zip).map((entry) => entry.name), ['boltbook.json'])
})

test('the export carries every table, the photos, and no credentials', async () => {
  const app = await freshApp()
  await app.request('/api/fabrics', json({ name: 'Linen', lengthMm: 2500, tags: ['linen'] }))
  await app.request('/api/patterns', json({ name: 'Archer', tags: ['shirt'] }))
  const fabric = await readJson<{ id: string }>(await app.request('/api/fabrics', json({ name: 'Chambray' })))
  const pixels = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  const photo = await readJson<{ id: string }>(
    await app.request(`/api/fabrics/${fabric.id}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(pixels),
    }),
  )

  const zip = await exportZip(app)
  const names = listEntries(zip).map((entry) => entry.name)
  assert.ok(names.includes('boltbook.json'))
  assert.ok(names.includes(`photos/${photo.id}.png`))

  // The photo bytes round-trip exactly.
  assert.deepEqual(readEntry(zip, `photos/${photo.id}.png`), pixels)

  const document = JSON.parse((readEntry(zip, 'boltbook.json') ?? Buffer.alloc(0)).toString('utf8')) as {
    format: string
    version: number
    tables: Record<string, unknown[]>
  }
  assert.equal(document.format, 'boltbook-export')
  assert.equal(document.version, 1)
  assert.equal(document.tables.fabric!.length, 2)
  assert.equal(document.tables.pattern!.length, 1)
  assert.equal(document.tables.tag!.length, 2)
  assert.equal(document.tables.tag_link!.length, 2)
  // Photo bytes live in photos/, and the metadata points at them.
  const photos = document.tables.fabric_photo as Array<{ id: string; file: string }>
  assert.equal(photos[0]!.file, `photos/${photo.id}.png`)

  // The export is data, never credentials.
  const raw = (readEntry(zip, 'boltbook.json') ?? Buffer.alloc(0)).toString('utf8')
  assert.equal(raw.includes('passphrase'), false)
  assert.equal(raw.includes('totp_secret'), false)
})

test('a pattern PDF and its thumbnail are exported as files, not base64', async () => {
  const app = await freshApp()
  const pattern = await readJson<{ id: string }>(await app.request('/api/patterns', json({ name: 'Archer' })))
  const pdf = Buffer.from('%PDF-1.4\n% a pattern\n%%EOF\n')
  const thumbnail = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])
  const file = await readJson<{ id: string }>(
    await app.request(`/api/patterns/${pattern.id}/file?pageCount=6&filename=Archer.pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array(pdf),
    }),
  )
  await app.request(`/api/patterns/${pattern.id}/file/${file.id}/thumbnail`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(thumbnail),
  })

  const zip = await exportZip(app)
  const names = listEntries(zip).map((entry) => entry.name)
  assert.ok(names.includes(`pattern-files/${file.id}.pdf`))
  assert.ok(names.includes(`pattern-files/thumbs/${file.id}.png`))
  assert.deepEqual(readEntry(zip, `pattern-files/${file.id}.pdf`), pdf)
  assert.deepEqual(readEntry(zip, `pattern-files/thumbs/${file.id}.png`), thumbnail)

  const document = JSON.parse((readEntry(zip, 'boltbook.json') ?? Buffer.alloc(0)).toString('utf8')) as {
    tables: { pattern_file: Array<{ id: string; file: string; thumbnail_file: string; page_count: number }> }
  }
  assert.equal(document.tables.pattern_file.length, 1)
  assert.equal(document.tables.pattern_file[0]!.file, `pattern-files/${file.id}.pdf`)
  assert.equal(document.tables.pattern_file[0]!.thumbnail_file, `pattern-files/thumbs/${file.id}.png`)
  assert.equal(document.tables.pattern_file[0]!.page_count, 6)
})

test('an export is recorded in the audit log', async () => {
  const app = await freshApp()
  await exportZip(app)
  const entries = await readJson<Array<{ event: string }>>(await app.request('/api/audit'))
  assert.ok(entries.some((entry) => entry.event === 'exported'))
})

test('exporting needs a session', async () => {
  const app = anonymousApp()
  assert.equal((await app.request('/api/export')).status, 401)
})

test('the records come back in a JSON export that matches the database', async () => {
  const app = await freshApp()
  const fabric = await readJson<{ id: string; name: string }>(await app.request('/api/fabrics', json({ name: 'Wool', lengthMm: 1600 })))
  const zip = await exportZip(app)
  const document = JSON.parse((readEntry(zip, 'boltbook.json') ?? Buffer.alloc(0)).toString('utf8')) as {
    tables: { fabric: Array<Record<string, unknown>> }
  }
  const exported = document.tables.fabric.find((row) => row.id === fabric.id)
  assert.ok(exported)
  assert.equal(exported.name, 'Wool')
  assert.equal(exported.length_mm, 1600)
})
