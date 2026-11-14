import path from 'node:path'

export interface ServerConfig {
  dataDirectory: string
  databaseFilePath: string
  port: number
  host: string
}

/** Environment → config. Defaults bind to localhost only; the proxy sets the rest. */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDirectory = environment.BOLTBOOK_DATA_DIR ?? './data'
  const databaseFilePath = environment.BOLTBOOK_DB ?? path.join(dataDirectory, 'boltbook.db')
  return {
    dataDirectory,
    databaseFilePath,
    port: Number(environment.BOLTBOOK_PORT ?? 8080),
    host: environment.BOLTBOOK_HOST ?? '127.0.0.1',
  }
}
