import { deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * A minimal ZIP writer — enough for one export, with no dependency.
 *
 * Entries are deflated (method 8) and names are flagged UTF-8. There is no
 * Zip64: a personal stash does not approach 4 GB, and if it ever did the
 * failure would be loud rather than silent.
 */

export interface ZipEntry {
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date and time, which is what the format stores. */
function dosDateTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

export function createZip(entries: readonly ZipEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(at)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const checksum = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // general purpose flags: UTF-8 names
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    localParts.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // offset of the local header
    centralParts.push(central, nameBytes)

    offset += local.length + nameBytes.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with the central directory
  end.writeUInt16LE(entries.length, 8) // entries on this disk
  end.writeUInt16LE(entries.length, 10) // entries in total
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16) // offset of the central directory
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDirectory, end])
}

export function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

/** Read a zip we wrote (or any store/deflate zip) into name → bytes. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  let endOfCentralDirectory = -1
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) {
      endOfCentralDirectory = index
      break
    }
  }
  if (endOfCentralDirectory < 0) throw new Error('Not a zip archive.')

  const count = zip.readUInt16LE(endOfCentralDirectory + 10)
  let offset = zip.readUInt32LE(endOfCentralDirectory + 16)
  const entries = new Map<string, Buffer>()

  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Damaged zip: bad central directory header.')
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localHeaderOffset = zip.readUInt32LE(offset + 42)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

    // The local header's name/extra lengths can differ from the central copy.
    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = zip.subarray(dataStart, dataStart + compressedSize)

    if (method === 8) entries.set(name, inflateRawSync(compressed))
    else if (method === 0) entries.set(name, Buffer.from(compressed))
    else throw new Error(`Unsupported compression method ${method} for ${name}.`)

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
