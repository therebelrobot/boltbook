import path from 'node:path'
import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { openDatabase } from './database'
import { loadStaticAssets } from './staticAssets'
import { createApplication } from './app'

const config = loadConfig()
const database = openDatabase(config.databaseFilePath)
const staticAssets = loadStaticAssets(path.resolve(process.cwd(), 'dist/client'))
const { app, sessions, account } = createApplication({ database, config, staticAssets })

// Drop expired sessions even while nobody is asking.
setInterval(() => sessions.sweepExpired(), 5 * 60_000).unref()

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`boltbook listening on http://${config.host}:${info.port}`)
  console.log(`data: ${config.databaseFilePath}`)
  console.log(`client: ${staticAssets.size > 0 ? `${staticAssets.size} assets from dist/client` : 'not built (npm run build)'}`)
  if (!account.isInitialized()) {
    const origin = config.setupTokenWasGenerated ? 'generated for this run; set BOLTBOOK_SETUP_TOKEN to choose your own' : 'from BOLTBOOK_SETUP_TOKEN'
    console.log(` Setup token: ${config.setupToken} (${origin})`)
  }
})

if (!config.cookieSecure) {
  console.warn('WARNING: BOLTBOOK_COOKIE_SECURE=false. Only do this for local development over plain HTTP.')
}
if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.warn('WARNING: bound beyond localhost. Make sure TLS and the access layer sit in front.')
}
