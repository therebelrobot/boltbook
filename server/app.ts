import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Database } from './database'
import type { ServerConfig } from './config'
import { FabricRepository, assertFabricInvariant } from './repositories/fabrics'
import { fabricInputSchema } from './schemas'
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from './errors'
import type { FabricFilters, SearchHit, Status } from '../shared/model'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export interface ApplicationDependencies {
  database: Database
  config?: ServerConfig
  currentTimeMilliseconds?: () => number
}

export function createApplication(dependencies: ApplicationDependencies) {
  const { database } = dependencies
  const currentTimeMilliseconds = dependencies.currentTimeMilliseconds ?? Date.now
  const nowIso = () => new Date(currentTimeMilliseconds()).toISOString()

  const fabrics = new FabricRepository(database)
  const app = new Hono()

  const readJsonBody = async <Schema extends z.ZodType>(context: Context, schema: Schema): Promise<z.infer<Schema>> =>
    schema.parse(await context.req.json().catch(() => ({})))

  // ---------- global headers ----------

  app.use('*', async (context, next) => {
    await next()
    context.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('X-Frame-Options', 'DENY')
    context.header('Referrer-Policy', 'no-referrer')
    context.header('Cross-Origin-Opener-Policy', 'same-origin')
    context.header('Cross-Origin-Resource-Policy', 'same-origin')
    context.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    if (dependencies.config?.port && dependencies.config.host !== '127.0.0.1') {
      // Placeholder: HSTS only becomes meaningful once TLS terminates in front (M7).
    }
  })

  // ---------- API ----------

  app.use('/api/*', bodyLimit({ maxSize: 8 * 1024 * 1024 }))
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    await next()
  })

  app.get('/api/status', (context) => {
    const status: Status = { ok: true, fabricCount: fabrics.count() }
    return context.json(status)
  })

  app.get('/api/fabrics', (context) => {
    const filters: FabricFilters = {}
    const fibre = context.req.query('fibre')
    if (fibre) filters.fibre = fibre
    const location = context.req.query('location')
    if (location) filters.location = location
    const minLengthMm = context.req.query('minLengthMm')
    if (minLengthMm) {
      const parsed = Number(minLengthMm)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new RecordValidationError('minLengthMm must be a non-negative number.')
      }
      filters.minLengthMm = Math.floor(parsed)
    }
    return context.json(fabrics.list(filters))
  })

  app.post('/api/fabrics', async (context) => {
    const input = await readJsonBody(context, fabricInputSchema)
    assertFabricInvariant(input)
    return context.json(fabrics.create(input, nowIso()), 201)
  })

  app.get('/api/fabrics/:fabricId', (context) => {
    const fabric = fabrics.get(context.req.param('fabricId'))
    if (!fabric) throw new RecordNotFoundError('No such fabric.')
    return context.json(fabric)
  })

  app.put('/api/fabrics/:fabricId', async (context) => {
    const input = await readJsonBody(context, fabricInputSchema)
    assertFabricInvariant(input)
    return context.json(fabrics.replace(context.req.param('fabricId'), input, nowIso()))
  })

  app.delete('/api/fabrics/:fabricId', (context) => {
    fabrics.delete(context.req.param('fabricId'))
    return context.json({ ok: true })
  })

  app.get('/api/search', (context) => {
    const query = context.req.query('q') ?? ''
    const hits: SearchHit[] = fabrics.search(query)
    return context.json(hits)
  })

  app.all('/api/*', (context) => context.json({ error: 'not_found', message: 'No such endpoint.' }, 404))

  // ---------- static client (M5) ----------

  app.get('*', (context) => context.text('Client not built. Run npm run build.', 503))

  // ---------- errors ----------

  app.onError((error, context) => {
    if (error instanceof RecordNotFoundError) return context.json({ error: 'not_found', message: error.message }, 404)
    if (error instanceof RecordConflictError) return context.json({ error: 'conflict', message: error.message }, 409)
    if (error instanceof RecordValidationError) return context.json({ error: 'invalid_request', message: error.message }, 400)
    if (error instanceof z.ZodError) {
      return context.json({ error: 'invalid_request', message: 'Some fields are missing or invalid.', issues: error.issues }, 400)
    }
    // Never echo internal errors; log the frames only, never the message.
    const stackFramesOnly = error instanceof Error ? (error.stack ?? '').split('\n').slice(1, 8).join('\n') : ''
    console.error(`Unhandled ${error instanceof Error ? error.name : 'error'}\n${stackFramesOnly}`)
    return context.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500)
  })

  return { app, fabrics }
}
