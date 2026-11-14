/**
 * Maintenance: clear the account so the instance can be claimed again with the
 * setup token. boltbook has no recovery code because it stores nothing encrypted
 * (docs/adr/0001) — the passphrase protects access, not the data. Your fabric,
 * patterns, thread, tools and projects are NOT touched.
 *
 * Usage: BOLTBOOK_DB=./data/boltbook.db npm run reset-passphrase -- --yes
 */
import { openDatabase } from '../server/database'

const databaseFilePath = process.env.BOLTBOOK_DB ?? './data/boltbook.db'

if (!process.argv.includes('--yes')) {
  console.error(`This clears the passphrase and authenticator on ${databaseFilePath}.`)
  console.error('The records themselves are untouched.')
  console.error('Re-run with --yes to proceed.')
  process.exit(1)
}

const database = openDatabase(databaseFilePath)
const existing = database.prepare('SELECT singleton_id FROM account WHERE singleton_id = 1').get()

if (!existing) {
  console.log(`No account to clear on ${databaseFilePath}.`)
  process.exit(0)
}

database.prepare('DELETE FROM account').run()
console.log(`Cleared the account on ${databaseFilePath}.`)
console.log('Restart the server and claim it with the setup token printed at startup.')
