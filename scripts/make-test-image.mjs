import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const width = 640
const height = 480
const header = Buffer.alloc(13)
header.writeUInt32BE(width, 0)
header.writeUInt32BE(height, 4)
header[8] = 8
header[9] = 2
const raw = Buffer.alloc(height * (1 + width * 3))
for (let y = 0; y < height; y += 1) {
  const row = y * (1 + width * 3)
  raw[row] = 0
  for (let x = 0; x < width; x += 1) {
    const offset = row + 1 + x * 3
    const wave = Math.sin((x / width) * Math.PI * 3) * 12 + Math.sin((y / height) * Math.PI * 5) * 8
    raw[offset] = Math.max(0, Math.min(255, 74 + wave))
    raw[offset + 1] = Math.max(0, Math.min(255, 96 + wave))
    raw[offset + 2] = Math.max(0, Math.min(255, 132 + wave))
  }
}
writeFileSync(
  process.argv[2] ?? '/tmp/boltbook-photo.png',
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]),
)
console.log('wrote', process.argv[2] ?? '/tmp/boltbook-photo.png')
