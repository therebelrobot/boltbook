/**
 * Back up the database: settle the write-ahead log, then copy the file.
 *
 * boltbook stores plaintext (docs/adr/0001), so the copy is readable with any
 * SQLite tool — a deliberate property, not a leak. It also means a backup is a
 * copy, not an export: there is no encryption key to keep alongside it.
 *
 *   BOLTBOOK_DB=./data/boltbook.db npm run backup -- ./backups
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../server/database'

const sourcePath = path.resolve(process.env.BOLTBOOK_DB ?? './data/boltbook.db')
const targetDirectory = path.resolve(process.argv[2] ?? './backups')

if (!statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
  console.error(`No database at ${sourcePath}.`)
  process.exit(1)
}

// Opening also runs any pending migration, so the copy is never mid-upgrade.
const database = openDatabase(sourcePath)
// Fold the WAL back into the main file so copying one file is enough.
database.exec('PRAGMA wal_checkpoint(TRUNCATE)')

mkdirSync(targetDirectory, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const targetPath = path.join(targetDirectory, `boltbook-${stamp}.db`)
copyFileSync(sourcePath, targetPath)

const { size } = statSync(targetPath)
console.log(`Backed up ${sourcePath}`)
console.log(`        → ${targetPath} (${(size / 1024).toFixed(1)} KB)`)
console.log('Plaintext by design; keep it wherever you keep your records.')
