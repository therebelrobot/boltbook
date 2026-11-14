import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { encodeBase32 } from './crypto/base32'
import { DEFAULT_SCRYPT_PARAMETERS, type ScryptParameters } from './crypto/scrypt'

export interface ServerConfig {
  dataDirectory: string
  databaseFilePath: string
  port: number
  host: string
  /** false only for local development over plain HTTP. Production must sit behind TLS. */
  cookieSecure: boolean
  /** true when behind a reverse proxy, so the client IP comes from X-Forwarded-For. */
  trustProxy: boolean
  /** Optional explicit origin (https://example.com). When unset, the Host header is used. */
  publicOrigin: string | null
  sessionIdleMinutes: number
  sessionMaxHours: number
  setupToken: string
  setupTokenWasGenerated: boolean
  scryptParameters: ScryptParameters
}

function readBoolean(environmentValue: string | undefined, fallback: boolean): boolean {
  if (environmentValue === undefined || environmentValue === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(environmentValue.toLowerCase())
}

function readPositiveInteger(environmentValue: string | undefined, fallback: number): number {
  const parsedValue = Number.parseInt(environmentValue ?? '', 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDirectory = path.resolve(process.cwd(), environment.BOLTBOOK_DATA_DIR ?? 'data')
  const configuredSetupToken = environment.BOLTBOOK_SETUP_TOKEN?.trim()
  return {
    dataDirectory,
    databaseFilePath: path.resolve(process.cwd(), environment.BOLTBOOK_DB ?? path.join(dataDirectory, 'boltbook.db')),
    port: readPositiveInteger(environment.BOLTBOOK_PORT ?? environment.PORT, 8080),
    host: environment.BOLTBOOK_HOST ?? '127.0.0.1',
    cookieSecure: readBoolean(environment.BOLTBOOK_COOKIE_SECURE, true),
    trustProxy: readBoolean(environment.BOLTBOOK_TRUST_PROXY, false),
    publicOrigin: environment.BOLTBOOK_PUBLIC_ORIGIN?.replace(/\/+$/, '') || null,
    sessionIdleMinutes: readPositiveInteger(environment.BOLTBOOK_SESSION_IDLE_MINUTES, 30),
    sessionMaxHours: readPositiveInteger(environment.BOLTBOOK_SESSION_MAX_HOURS, 12),
    setupToken: configuredSetupToken || encodeBase32(randomBytes(10)),
    setupTokenWasGenerated: !configuredSetupToken,
    scryptParameters: {
      costFactorN: readPositiveInteger(environment.BOLTBOOK_SCRYPT_N, DEFAULT_SCRYPT_PARAMETERS.costFactorN),
      blockSizeR: DEFAULT_SCRYPT_PARAMETERS.blockSizeR,
      parallelizationP: DEFAULT_SCRYPT_PARAMETERS.parallelizationP,
    },
  }
}
