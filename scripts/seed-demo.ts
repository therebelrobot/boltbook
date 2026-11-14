/**
 * Fill a running instance with plausible demo data, for screenshots and for
 * poking at the client without entering twenty fabrics by hand.
 *
 *   BOLTBOOK_URL=http://127.0.0.1:8080 \
 *   BOLTBOOK_SETUP_TOKEN=<from the server log> \
 *   BOLTBOOK_PASSPHRASE='at least twelve characters' \
 *   node --import tsx scripts/seed-demo.ts
 *
 * Claims the instance if it is unclaimed, otherwise signs in. Safe to re-run:
 * it just adds more rows.
 */
import { deflateSync } from 'node:zlib'

const baseUrl = (process.env.BOLTBOOK_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
const setupToken = process.env.BOLTBOOK_SETUP_TOKEN ?? ''
const passphrase = process.env.BOLTBOOK_PASSPHRASE ?? ''

let cookie = ''

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'x-boltbook-request': '1',
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]!
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`)
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// ---------- a minimal solid-colour PNG, so the demo has photos ----------

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ])
}

async function uploadPhoto(fabricId: string, png: Buffer): Promise<void> {
  const response = await fetch(`${baseUrl}/api/fabrics/${fabricId}/photos`, {
    method: 'POST',
    headers: { 'x-boltbook-request': '1', cookie, 'content-type': 'image/png' },
    body: new Uint8Array(png),
  })
  if (!response.ok) throw new Error(`photo upload → ${response.status} ${await response.text()}`)
}

// ---------- seed ----------

async function main(): Promise<void> {
  const status = await call<{ claimed: boolean }>('/api/status')
  if (!status.claimed) {
    if (!setupToken || !passphrase) throw new Error('Set BOLTBOOK_SETUP_TOKEN and BOLTBOOK_PASSPHRASE to claim.')
    await call('/api/setup', 'POST', { setupToken, passphrase })
    console.log('claimed the instance')
  } else {
    if (!passphrase) throw new Error('Set BOLTBOOK_PASSPHRASE to sign in.')
    await call('/api/login', 'POST', { passphrase })
    console.log('signed in')
  }

  const fabrics: Array<[Record<string, unknown>, [number, number, number] | null]> = [
    [{ name: 'Washed linen', fibre: 'linen', weight: 'mid', colour: 'oatmeal', lengthMm: 2500, widthMm: 1400, originalLengthMm: 3000, location: 'Bin A', care: 'wash cold', tags: ['linen', 'summer'] }, [214, 205, 186]],
    [{ name: 'Indigo chambray', fibre: 'cotton', colour: 'indigo', lengthMm: 1800, widthMm: 1150, originalLengthMm: 2000, location: 'Bin A', notes: 'lightweight for a shirt', tags: ['cotton', 'shirt'] }, [58, 74, 104]],
    [{ name: 'Wool coating', fibre: 'wool', colour: 'camel', lengthMm: 1600, widthMm: 1500, originalLengthMm: 1800, location: 'Chest', care: 'dry clean', tags: ['wool', 'winter'] }, [178, 140, 96]],
    [{ name: 'Silk habotai', fibre: 'silk', colour: 'pearl', lengthMm: 900, widthMm: 1140, location: 'Drawer 2', tags: ['silk', 'lining'] }, [232, 226, 219]],
  ]

  const fabricIds: string[] = []
  for (const [body, colour] of fabrics) {
    const created = await call<{ id: string }>('/api/fabrics', 'POST', body)
    fabricIds.push(created.id)
    if (colour) await uploadPhoto(created.id, solidPng(600, 450, colour))
  }
  console.log(`${fabricIds.length} fabrics`)

  const threads = await Promise.all([
    call<{ id: string }>('/api/threads', 'POST', { name: 'Mara 120', brand: 'Gütermann', colour: 'ecru', colourCode: '169', fibre: 'polyester', weight: '120', spools: 3, lengthM: 900, originalLengthM: 1000, needleSize: '80/12', location: 'Thread box', tags: ['shirt'] }),
    call<{ id: string }>('/api/threads', 'POST', { name: 'Mara 120', brand: 'Gütermann', colour: 'navy', colourCode: '361', fibre: 'polyester', weight: '120', spools: 2, lengthM: 200, originalLengthM: 1000, location: 'Thread box', tags: ['jeans'] }),
    call<{ id: string }>('/api/threads', 'POST', { name: 'Silk 50', brand: 'Gütermann', colour: 'cream', fibre: 'silk', lengthM: 100, location: 'Thread box', tags: ['silk'] }),
  ])

  const notions = await Promise.all([
    call<{ id: string }>('/api/notions', 'POST', { name: 'Metal zip 20 cm', kind: 'zipper', colour: 'brass', quantity: 5, unit: 'piece', location: 'Notions tin', tags: ['jeans'] }),
    call<{ id: string }>('/api/notions', 'POST', { name: 'Corozo buttons 15 mm', kind: 'button', colour: 'cream', quantity: 24, unit: 'piece', tags: ['shirt'] }),
    call<{ id: string }>('/api/notions', 'POST', { name: 'Tricot interfacing', kind: 'interfacing', colour: 'white', quantity: 2, unit: 'm' }),
  ])

  await Promise.all([
    call('/api/tools', 'POST', { name: 'Rotary cutter', category: 'cutting', brand: 'Olfa', spec: '45 mm', quantity: 1, location: 'Cutting table', needsAttention: true, tags: ['sharp'] }),
    call('/api/tools', 'POST', { name: 'Quilting ruler', category: 'measuring', brand: 'Omnigrid', spec: '6 × 24 in', quantity: 1, location: 'Cutting table' }),
    call('/api/tools', 'POST', { name: "Tailor's shears", category: 'cutting', brand: 'Fiskars', quantity: 1, needsAttention: true, tags: ['sharp'] }),
  ])

  const archer = await call<{ id: string }>('/api/patterns', 'POST', { name: 'Archer Button-Up', brand: 'Grainline', number: '1001', format: 'pdf', category: 'tops', sizeMin: '0', sizeMax: '18', difficulty: 'intermediate', triedAndTrue: true, tags: ['shirt', 'tried-and-true'] })
  await call('/api/patterns', 'POST', { name: 'Ginger Jeans', brand: 'Closet Core', format: 'envelope', category: 'bottoms', sizeMin: '0', sizeMax: '20', tags: ['jeans'] })
  await call('/api/patterns', 'POST', { name: 'Hinterland Dress', brand: 'Sew Liberated', format: 'pdf', category: 'dresses', difficulty: 'beginner', tags: ['dress'] })

  const view = await call<{ id: string }>(`/api/patterns/${archer.id}/views`, 'POST', { label: 'A', description: 'button-up, long sleeve' })
  await call(`/api/patterns/${archer.id}/views/${view.id}/requirements`, 'POST', { role: 'main', lengthMm: 1800, fabricWidthMm: 1400, note: 'with nap, see chart' })
  await call(`/api/patterns/${archer.id}/views/${view.id}/requirements`, 'POST', { role: 'interfacing', lengthMm: 400, fabricWidthMm: 900 })

  const shirt = await call<{ id: string }>('/api/projects', 'POST', { title: 'Archer shirt in linen', status: 'cutting', startedOn: '2026-11-10', tags: ['shirt', 'summer'] })
  await call(`/api/projects/${shirt.id}/allocations`, 'PUT', {
    fabrics: [{ fabricId: fabricIds[0], lengthMmUsed: 2800 }],
    threads: [{ threadId: threads[0]!.id, lengthMUsed: 400 }],
    notions: [{ notionId: notions[1]!.id, quantityUsed: 12 }],
  })

  const chambray = await call<{ id: string }>('/api/projects', 'POST', { title: 'Chambray Archer, second go', status: 'planned', patternViewId: view.id, tags: ['shirt'] })
  await call(`/api/projects/${chambray.id}/allocations`, 'PUT', {
    fabrics: [{ fabricId: fabricIds[1], lengthMmUsed: 1500 }],
    threads: [{ threadId: threads[1]!.id, lengthMUsed: 300 }],
  })

  console.log('seeded 3 patterns, 2 projects, 3 threads, 3 notions, 3 tools')
}

await main()
