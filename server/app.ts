import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Database } from './database'
import type { ServerConfig } from './config'
import { FabricRepository, assertFabricInvariant } from './repositories/fabrics'
import { PatternRepository } from './repositories/patterns'
import { NotionRepository } from './repositories/notions'
import { ThreadRepository, assertThreadInvariant } from './repositories/threads'
import { ToolRepository } from './repositories/tools'
import { searchAll } from './repositories/search'
import {
  fabricInputSchema,
  notionInputSchema,
  patternInputSchema,
  patternRequirementInputSchema,
  patternViewInputSchema,
  threadInputSchema,
  toolInputSchema,
} from './schemas'
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from './errors'
import type {
  FabricFilters,
  NotionFilters,
  NotionKind,
  PatternFilters,
  PatternFormat,
  SearchHit,
  Status,
  ThreadFilters,
  ToolCategory,
  ToolFilters,
} from '../shared/model'

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

const PATTERN_FORMATS: readonly PatternFormat[] = ['envelope', 'pdf', 'book', 'other']
const NOTION_KINDS: readonly NotionKind[] = ['button', 'zipper', 'interfacing', 'elastic', 'trim', 'other']
const TOOL_CATEGORIES: readonly ToolCategory[] = ['cutting', 'measuring', 'pressing', 'machine', 'marking', 'needles_pins', 'other']

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
  const patterns = new PatternRepository(database)
  const notions = new NotionRepository(database)
  const threads = new ThreadRepository(database)
  const tools = new ToolRepository(database)
  const app = new Hono()

  const readJsonBody = async <Schema extends z.ZodType>(context: Context, schema: Schema): Promise<z.infer<Schema>> =>
    schema.parse(await context.req.json().catch(() => ({})))

  const booleanQuery = (value: string | undefined, name: string): boolean | undefined => {
    if (value === undefined) return undefined
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    throw new RecordValidationError(`${name} must be true or false.`)
  }

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
  })

  // ---------- API ----------

  app.use('/api/*', bodyLimit({ maxSize: 8 * 1024 * 1024 }))
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    await next()
  })

  app.get('/api/status', (context) => {
    const status: Status = {
      ok: true,
      fabricCount: fabrics.count(),
      patternCount: patterns.count(),
      notionCount: notions.count(),
      threadCount: threads.count(),
      toolCount: tools.count(),
    }
    return context.json(status)
  })

  // Fabric

  app.get('/api/fabrics', (context) => {
    const filters: FabricFilters = {}
    const fibre = context.req.query('fibre')
    if (fibre) filters.fibre = fibre
    const location = context.req.query('location')
    if (location) filters.location = location
    const minLengthMm = context.req.query('minLengthMm')
    if (minLengthMm) {
      const parsed = Number(minLengthMm)
      if (!Number.isFinite(parsed) || parsed < 0) throw new RecordValidationError('minLengthMm must be a non-negative number.')
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

  // Pattern (with nested views and requirements)

  app.get('/api/patterns', (context) => {
    const filters: PatternFilters = {}
    const brand = context.req.query('brand')
    if (brand) filters.brand = brand
    const category = context.req.query('category')
    if (category) filters.category = category
    const format = context.req.query('format')
    if (format) {
      if (!PATTERN_FORMATS.includes(format as PatternFormat)) throw new RecordValidationError('Unknown format.')
      filters.format = format as PatternFormat
    }
    const triedAndTrue = booleanQuery(context.req.query('triedAndTrue'), 'triedAndTrue')
    if (triedAndTrue !== undefined) filters.triedAndTrue = triedAndTrue
    return context.json(patterns.list(filters))
  })

  app.post('/api/patterns', async (context) => {
    const input = await readJsonBody(context, patternInputSchema)
    return context.json(patterns.create(input, nowIso()), 201)
  })

  app.get('/api/patterns/:patternId', (context) => {
    const pattern = patterns.get(context.req.param('patternId'))
    if (!pattern) throw new RecordNotFoundError('No such pattern.')
    return context.json(pattern)
  })

  app.put('/api/patterns/:patternId', async (context) => {
    const input = await readJsonBody(context, patternInputSchema)
    return context.json(patterns.replace(context.req.param('patternId'), input, nowIso()))
  })

  app.delete('/api/patterns/:patternId', (context) => {
    patterns.delete(context.req.param('patternId'))
    return context.json({ ok: true })
  })

  app.post('/api/patterns/:patternId/views', async (context) => {
    const input = await readJsonBody(context, patternViewInputSchema)
    return context.json(patterns.addView(context.req.param('patternId'), input, nowIso()), 201)
  })

  app.put('/api/patterns/:patternId/views/:viewId', async (context) => {
    const input = await readJsonBody(context, patternViewInputSchema)
    return context.json(patterns.replaceView(context.req.param('patternId'), context.req.param('viewId'), input, nowIso()))
  })

  app.delete('/api/patterns/:patternId/views/:viewId', (context) => {
    patterns.deleteView(context.req.param('patternId'), context.req.param('viewId'))
    return context.json({ ok: true })
  })

  app.post('/api/patterns/:patternId/views/:viewId/requirements', async (context) => {
    const input = await readJsonBody(context, patternRequirementInputSchema)
    return context.json(
      patterns.addRequirement(context.req.param('patternId'), context.req.param('viewId'), input, nowIso()),
      201,
    )
  })

  app.put('/api/patterns/:patternId/views/:viewId/requirements/:requirementId', async (context) => {
    const input = await readJsonBody(context, patternRequirementInputSchema)
    return context.json(
      patterns.replaceRequirement(
        context.req.param('patternId'),
        context.req.param('viewId'),
        context.req.param('requirementId'),
        input,
        nowIso(),
      ),
    )
  })

  app.delete('/api/patterns/:patternId/views/:viewId/requirements/:requirementId', (context) => {
    patterns.deleteRequirement(
      context.req.param('patternId'),
      context.req.param('viewId'),
      context.req.param('requirementId'),
      nowIso(),
    )
    return context.json({ ok: true })
  })

  // Notion

  app.get('/api/notions', (context) => {
    const filters: NotionFilters = {}
    const kind = context.req.query('kind')
    if (kind) {
      if (!NOTION_KINDS.includes(kind as NotionKind)) throw new RecordValidationError('Unknown notion kind.')
      filters.kind = kind as NotionKind
    }
    const location = context.req.query('location')
    if (location) filters.location = location
    return context.json(notions.list(filters))
  })

  app.post('/api/notions', async (context) => {
    const input = await readJsonBody(context, notionInputSchema)
    return context.json(notions.create(input, nowIso()), 201)
  })

  app.get('/api/notions/:notionId', (context) => {
    const notion = notions.get(context.req.param('notionId'))
    if (!notion) throw new RecordNotFoundError('No such notion.')
    return context.json(notion)
  })

  app.put('/api/notions/:notionId', async (context) => {
    const input = await readJsonBody(context, notionInputSchema)
    return context.json(notions.replace(context.req.param('notionId'), input, nowIso()))
  })

  app.delete('/api/notions/:notionId', (context) => {
    notions.delete(context.req.param('notionId'))
    return context.json({ ok: true })
  })

  // Thread

  app.get('/api/threads', (context) => {
    const filters: ThreadFilters = {}
    const colour = context.req.query('colour')
    if (colour) filters.colour = colour
    const fibre = context.req.query('fibre')
    if (fibre) filters.fibre = fibre
    const location = context.req.query('location')
    if (location) filters.location = location
    return context.json(threads.list(filters))
  })

  app.post('/api/threads', async (context) => {
    const input = await readJsonBody(context, threadInputSchema)
    assertThreadInvariant(input)
    return context.json(threads.create(input, nowIso()), 201)
  })

  app.get('/api/threads/:threadId', (context) => {
    const thread = threads.get(context.req.param('threadId'))
    if (!thread) throw new RecordNotFoundError('No such thread.')
    return context.json(thread)
  })

  app.put('/api/threads/:threadId', async (context) => {
    const input = await readJsonBody(context, threadInputSchema)
    assertThreadInvariant(input)
    return context.json(threads.replace(context.req.param('threadId'), input, nowIso()))
  })

  app.delete('/api/threads/:threadId', (context) => {
    threads.delete(context.req.param('threadId'))
    return context.json({ ok: true })
  })

  // Tool

  app.get('/api/tools', (context) => {
    const filters: ToolFilters = {}
    const category = context.req.query('category')
    if (category) {
      if (!TOOL_CATEGORIES.includes(category as ToolCategory)) throw new RecordValidationError('Unknown tool category.')
      filters.category = category as ToolCategory
    }
    const location = context.req.query('location')
    if (location) filters.location = location
    const needsAttention = booleanQuery(context.req.query('needsAttention'), 'needsAttention')
    if (needsAttention !== undefined) filters.needsAttention = needsAttention
    return context.json(tools.list(filters))
  })

  app.post('/api/tools', async (context) => {
    const input = await readJsonBody(context, toolInputSchema)
    return context.json(tools.create(input, nowIso()), 201)
  })

  app.get('/api/tools/:toolId', (context) => {
    const tool = tools.get(context.req.param('toolId'))
    if (!tool) throw new RecordNotFoundError('No such tool.')
    return context.json(tool)
  })

  app.put('/api/tools/:toolId', async (context) => {
    const input = await readJsonBody(context, toolInputSchema)
    return context.json(tools.replace(context.req.param('toolId'), input, nowIso()))
  })

  app.delete('/api/tools/:toolId', (context) => {
    tools.delete(context.req.param('toolId'))
    return context.json({ ok: true })
  })

  // Search

  app.get('/api/search', (context) => {
    const query = context.req.query('q') ?? ''
    const hits: SearchHit[] = searchAll(database, query)
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
    const stackFramesOnly = error instanceof Error ? (error.stack ?? '').split('\n').slice(1, 8).join('\n') : ''
    console.error(`Unhandled ${error instanceof Error ? error.name : 'error'}\n${stackFramesOnly}`)
    return context.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500)
  })

  return { app, fabrics, patterns, notions, threads, tools }
}
