import { scrypt as scryptCallback } from 'node:crypto'

export interface ScryptParameters {
  costFactorN: number
  blockSizeR: number
  parallelizationP: number
}

/** ~128 MiB working memory; roughly 0.5-1.5 s on a Raspberry Pi 4/5. */
export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  costFactorN: 2 ** 17,
  blockSizeR: 8,
  parallelizationP: 1,
}

export const DERIVED_KEY_BYTES = 32

/**
 * Derive a key from a secret with scrypt. Used for the passphrase hash — not to
 * wrap a data key, because boltbook has none (docs/adr/0001).
 */
export async function deriveKey(secretText: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  // NFKC so the same passphrase typed on different keyboards/OSes derives the same key.
  const normalizedSecret = secretText.normalize('NFKC')
  const workingMemoryBytes = 128 * parameters.costFactorN * parameters.blockSizeR
  return new Promise((resolve, reject) => {
    scryptCallback(
      normalizedSecret,
      salt,
      DERIVED_KEY_BYTES,
      {
        N: parameters.costFactorN,
        r: parameters.blockSizeR,
        p: parameters.parallelizationP,
        maxmem: workingMemoryBytes * 2,
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    )
  })
}
