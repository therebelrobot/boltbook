import { randomBytes } from 'node:crypto'
import type { Database } from './database'
import { decodeBase32, encodeBase32 } from './crypto/base32'
import { constantTimeEqual } from './crypto/compare'
import { DEFAULT_SCRYPT_PARAMETERS, deriveKey, type ScryptParameters } from './crypto/scrypt'
import { verifyTotpCode } from './crypto/totp'
import { AuthError } from './errors'

const SALT_BYTES = 16
const TOTP_SECRET_BYTES = 20
export const MINIMUM_PASSPHRASE_LENGTH = 12

interface AccountRow {
  singleton_id: number
  created_at: string
  scrypt_n: number
  scrypt_r: number
  scrypt_p: number
  passphrase_salt: Uint8Array
  passphrase_hash: Uint8Array
  totp_secret: string | null
  totp_last_accepted_counter: number | null
}

function assertPassphraseStrength(passphrase: string): void {
  if ([...passphrase.normalize('NFKC')].length < MINIMUM_PASSPHRASE_LENGTH) {
    throw new AuthError('weak_passphrase', `Use at least ${MINIMUM_PASSPHRASE_LENGTH} characters.`)
  }
}

/**
 * Single-user access. The passphrase is stored as a scrypt hash; the TOTP secret
 * is stored in the clear because there is no key to wrap it under — see
 * docs/adr/0001. Losing the passphrase is a maintenance reset, not a recovery
 * code: `scripts/reset-passphrase.ts` clears the account so the setup token
 * claims the instance again.
 */
export class AccountService {
  constructor(
    private readonly database: Database,
    private readonly parametersForNewAccount: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
    private readonly currentTimeMilliseconds: () => number = Date.now,
  ) {}

  isInitialized(): boolean {
    return this.#row() !== null
  }

  isTotpEnabled(): boolean {
    return this.#row()?.totp_secret != null
  }

  async initialize(passphrase: string): Promise<void> {
    if (this.isInitialized()) throw new AuthError('already_claimed', 'This instance is already set up.')
    assertPassphraseStrength(passphrase)
    const salt = randomBytes(SALT_BYTES)
    const hash = await deriveKey(passphrase, salt, this.parametersForNewAccount)
    try {
      this.database
        .prepare(
          `INSERT INTO account (singleton_id, created_at, scrypt_n, scrypt_r, scrypt_p,
             passphrase_salt, passphrase_hash)
           VALUES (1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          new Date(this.currentTimeMilliseconds()).toISOString(),
          this.parametersForNewAccount.costFactorN,
          this.parametersForNewAccount.blockSizeR,
          this.parametersForNewAccount.parallelizationP,
          salt,
          hash,
        )
    } finally {
      hash.fill(0)
    }
  }

  async verifyPassphrase(passphrase: string): Promise<boolean> {
    const row = this.#require()
    const candidate = await deriveKey(passphrase, Buffer.from(row.passphrase_salt), this.#parameters(row))
    try {
      return constantTimeEqual(candidate, Buffer.from(row.passphrase_hash))
    } finally {
      candidate.fill(0)
    }
  }

  /** Throws on failure; returns nothing on success. */
  async unlock(passphrase: string, totpCode: string | undefined): Promise<void> {
    const row = this.#require()
    // Ask for the code before checking the passphrase, so this never confirms a
    // correct passphrase to someone who lacks the authenticator.
    if (row.totp_secret && !totpCode) {
      throw new AuthError('totp_required', 'Enter the 6-digit code from your authenticator app.')
    }
    if (!(await this.verifyPassphrase(passphrase))) {
      throw new AuthError('wrong_credentials', 'That passphrase or code is not right.')
    }
    if (row.totp_secret) {
      const acceptedCounter = verifyTotpCode(
        decodeBase32(row.totp_secret),
        totpCode ?? '',
        this.currentTimeMilliseconds(),
        row.totp_last_accepted_counter,
      )
      if (acceptedCounter === null) {
        throw new AuthError('wrong_credentials', 'That passphrase or code is not right.')
      }
      this.database.prepare('UPDATE account SET totp_last_accepted_counter = ? WHERE singleton_id = 1').run(acceptedCounter)
    }
  }

  async changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
    assertPassphraseStrength(newPassphrase)
    if (!(await this.verifyPassphrase(currentPassphrase))) {
      throw new AuthError('wrong_credentials', 'That passphrase is not right.')
    }
    const row = this.#require()
    const salt = randomBytes(SALT_BYTES)
    const hash = await deriveKey(newPassphrase, salt, this.#parameters(row))
    try {
      this.database
        .prepare('UPDATE account SET passphrase_salt = ?, passphrase_hash = ? WHERE singleton_id = 1')
        .run(salt, hash)
    } finally {
      hash.fill(0)
    }
  }

  createPendingTotpSecret(): { secret: Buffer; secretBase32: string } {
    const secret = randomBytes(TOTP_SECRET_BYTES)
    return { secret, secretBase32: encodeBase32(secret) }
  }

  confirmTotpEnrollment(pendingSecret: Buffer, submittedCode: string): void {
    const acceptedCounter = verifyTotpCode(pendingSecret, submittedCode, this.currentTimeMilliseconds(), null)
    if (acceptedCounter === null) {
      throw new AuthError('totp_invalid', 'That code did not match. Check the clock on your phone and try the next code.')
    }
    this.database
      .prepare('UPDATE account SET totp_secret = ?, totp_last_accepted_counter = ? WHERE singleton_id = 1')
      .run(encodeBase32(pendingSecret), acceptedCounter)
  }

  disableTotp(): void {
    this.database.prepare('UPDATE account SET totp_secret = NULL, totp_last_accepted_counter = NULL WHERE singleton_id = 1').run()
  }

  #parameters(row: AccountRow): ScryptParameters {
    return { costFactorN: row.scrypt_n, blockSizeR: row.scrypt_r, parallelizationP: row.scrypt_p }
  }

  #row(): AccountRow | null {
    return (this.database.prepare('SELECT * FROM account WHERE singleton_id = 1').get() as AccountRow | undefined) ?? null
  }

  #require(): AccountRow {
    const row = this.#row()
    if (!row) throw new AuthError('not_claimed', 'This instance has not been set up yet.')
    return row
  }
}
