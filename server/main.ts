import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { openDatabase } from './database'
import { createApplication } from './app'

const config = loadConfig()
const database = openDatabase(config.databaseFilePath)
const { app } = createApplication({ database, config })

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`boltbook listening on http://${config.host}:${info.port}`)
  console.log(`data: ${config.databaseFilePath}`)
})

if (config.host !== '127.0.0.1') {
  console.warn('WARNING: bound beyond localhost. Auth lands at M4; do not expose this yet.')
}
