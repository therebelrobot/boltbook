import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import type { Database } from './database'
import type { ServerConfig } from './config'
import { AccountService } from './auth'
import { AuditLog } from './audit'
import { SessionStore } from './sessions'
import { UnlockRateLimiter } from './rateLimiter'
import { FabricRepository, assertFabricInvariant } from './repositories/fabrics'
import { PatternRepository } from './repositories/patterns'
import { NotionRepository } from './repositories/notions'
import { ThreadRepository, assertThreadInvariant } from './repositories/threads'
import { ToolRepository } from './repositories/tools'
import { ProjectRepository } from './repositories/projects'
import { TagsRepository } from './repositories/tags'
import { searchAll } from './repositories/search'
import { buildExportZip } from './export'
import { importExport } from './import'
import {
  FABRIC_ALLOCATION_MEASURES,
  FABRIC_MEASURES,
  REQUIREMENT_MEASURES,
  THREAD_ALLOCATION_MEASURES,
  THREAD_MEASURES,
  normalizeMeasures,
  parseUnits,
  presentMeasures,
  presentShortfallLines,
  type MeasureSpec,
  type Units,
} from './units'
import type { StaticAsset } from './staticAssets'
import { buildOtpauthUri } from './crypto/totp'
import {
  allocationsInputSchema,
  fabricInputSchema,
  loginRequestSchema,
  notionInputSchema,
  passphraseChangeRequestSchema,
  passphraseConfirmationSchema,
  patternInputSchema,
  patternRequirementInputSchema,
  patternViewInputSchema,
  projectInputSchema,
  setupRequestSchema,
  tagInputSchema,
  threadInputSchema,
  toolInputSchema,
  totpConfirmRequestSchema,
} from './schemas'
import { AuthError, RecordConflictError, RecordNotFoundError, RecordValidationError } from './errors'
import type {
  AuthStatus,
  FabricFilters,
  NotionFilters,
  NotionKind,
  Pattern,
  PatternFilters,
  PatternFormat,
  Project,
  ProjectFilters,
  ProjectStatus,
  SearchHit,
  ShortfallLine,
  Status,
  ThreadFilters,
  ToolCategory,
  ToolFilters,
} from '../shared/model'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: is what the pending-photo preview uses before upload; without it the
  // image is blocked inline while the blob URL still opens in a new tab.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Every state-changing request must carry this; browsers won't send it cross-site without a preflight we never grant. */
export const REQUIRED_REQUEST_HEADER = 'x-boltbook-request'

const PATTERN_FORMATS: readonly PatternFormat[] = ['envelope', 'pdf', 'book', 'other']
const NOTION_KINDS: readonly NotionKind[] = ['button', 'zipper', 'interfacing', 'elastic', 'trim', 'other']
const TOOL_CATEGORIES: readonly ToolCategory[] = ['cutting', 'measuring', 'pressing', 'machine', 'marking', 'needles_pins', 'other']
const PROJECT_STATUSES: readonly ProjectStatus[] = ['planned', 'cutting', 'sewing', 'done', 'abandoned']

/** Photos are downscaled in the browser before upload; these are the last line of defence. */
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

const STATUS_BY_AUTH_ERROR = {
  already_claimed: 409,
  not_claimed: 409,
  wrong_setup_token: 401,
  wrong_credentials: 401,
  totp_required: 401,
  weak_passphrase: 400,
  totp_not_pending: 409,
  totp_invalid: 400,
  not_signed_in: 401,
} as const

export interface ApplicationDependencies {
  database: Database
  config: ServerConfig
  staticAssets?: Map<string, StaticAsset>
  currentTimeMilliseconds?: () => number
}

export function createApplication(dependencies: ApplicationDependencies) {
  const { database, config } = dependencies
  const currentTimeMilliseconds = dependencies.currentTimeMilliseconds ?? Date.now
  const nowIso = () => new Date(currentTimeMilliseconds()).toISOString()

  const fabrics = new FabricRepository(database)
  const patterns = new PatternRepository(database)
  const notions = new NotionRepository(database)
  const threads = new ThreadRepository(database)
  const tools = new ToolRepository(database)
  const projects = new ProjectRepository(database)
  const tags = new TagsRepository(database)
  const account = new AccountService(database, config.scryptParameters, currentTimeMilliseconds)
  const sessions = new SessionStore(
    config.sessionIdleMinutes * 60_000,
    config.sessionMaxHours * 3_600_000,
    currentTimeMilliseconds,
  )
  const unlockRateLimiter = new UnlockRateLimiter(currentTimeMilliseconds)
  const auditLog = new AuditLog(database)

  // __Host- cookies must be Secure, Path=/ and have no Domain.
  const sessionCookieName = config.cookieSecure ? '__Host-boltbook_session' : 'boltbook_session'

  const app = new Hono()

  // ---------- helpers ----------

  const clientIpAddress = (context: Context): string => {
    if (config.trustProxy) {
      // Take the hop our trusted proxy appended (rightmost), not the client-supplied leftmost one.
      const forwardedFor = context.req.header('x-forwarded-for')
      const proxyAppendedAddress = forwardedFor?.split(',').map((part) => part.trim()).filter(Boolean).at(-1)
      if (proxyAppendedAddress) return proxyAppendedAddress
    }
    try {
      return getConnInfo(context).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const audit = (context: Context, event: string): void =>
    auditLog.record(event, clientIpAddress(context), context.req.header('user-agent') ?? '', nowIso())

  const startSession = (context: Context): void => {
    const { sessionToken } = sessions.create()
    setCookie(context, sessionCookieName, sessionToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Strict',
      path: '/',
      maxAge: config.sessionMaxHours * 3600,
    })
  }

  const endSession = (context: Context): void => {
    sessions.destroy(getCookie(context, sessionCookieName))
    deleteCookie(context, sessionCookieName, { path: '/', secure: config.cookieSecure })
  }

  const rejectIfRateLimited = (context: Context): Response | null => {
    const retryAfterMilliseconds = unlockRateLimiter.retryAfterMilliseconds(clientIpAddress(context))
    if (retryAfterMilliseconds <= 0) return null
    const retryAfterSeconds = Math.ceil(retryAfterMilliseconds / 1000)
    context.header('Retry-After', String(retryAfterSeconds))
    return context.json({ error: 'rate_limited', message: 'Too many attempts. Try again shortly.', retryAfterSeconds }, 429)
  }

  const readJsonBody = async <Schema extends z.ZodType>(context: Context, schema: Schema): Promise<z.infer<Schema>> =>
    schema.parse(await context.req.json().catch(() => ({})))

  /** Reads a body, converting any imperial measure fields to canonical metric first. */
  const readMeasuredBody = async <Schema extends z.ZodType>(
    context: Context,
    schema: Schema,
    specs: readonly MeasureSpec[],
  ): Promise<z.infer<Schema>> => {
    const raw = (await context.req.json().catch(() => ({}))) as Record<string, unknown>
    return schema.parse(normalizeMeasures(raw, specs))
  }

  const unitsOf = (context: Context): Units => parseUnits(context.req.query('units'))

  /** Measures nested inside a pattern's views move together with the top-level ones. */
  const presentPattern = (pattern: Pattern, units: Units): Pattern => {
    if (units === 'metric') return pattern
    return {
      ...pattern,
      views: pattern.views.map((view) => ({
        ...view,
        requirements: view.requirements.map((requirement) =>
          presentMeasures(requirement as unknown as Record<string, unknown>, REQUIREMENT_MEASURES, units),
        ),
      })),
    } as unknown as Pattern
  }

  /** Likewise a project's allocations. */
  const presentProject = (project: Project, units: Units): Project => {
    if (units === 'metric') return project
    return {
      ...project,
      allocations: {
        fabrics: project.allocations.fabrics.map((allocation) =>
          presentMeasures(allocation as unknown as Record<string, unknown>, FABRIC_ALLOCATION_MEASURES, units),
        ),
        threads: project.allocations.threads.map((allocation) =>
          presentMeasures(allocation as unknown as Record<string, unknown>, THREAD_ALLOCATION_MEASURES, units),
        ),
        notions: project.allocations.notions,
      },
    } as unknown as Project
  }

  const booleanQuery = (value: string | undefined, name: string): boolean | undefined => {
    if (value === undefined) return undefined
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    throw new RecordValidationError(`${name} must be true or false.`)
  }

  const optionalIntegerQuery = (context: Context, name: string, maximum: number): number | null => {
    const raw = context.req.query(name)
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
      throw new RecordValidationError(`${name} must be a non-negative integer no larger than ${maximum}.`)
    }
    return parsed
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
    if (config.cookieSecure) context.header('Strict-Transport-Security', 'max-age=31536000')
  })

  // ---------- API guards ----------

  // Generous because an import is one zip of everything; the photo route keeps
  // its own 8 MB rule, and the import route is guarded by mode=replace.
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 * 1024 }))
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('Pragma', 'no-cache')
    const method = context.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      if (context.req.header(REQUIRED_REQUEST_HEADER) !== '1') {
        return context.json({ error: 'forbidden', message: 'Missing request header.' }, 403)
      }
      const originHeader = context.req.header('origin')
      if (originHeader) {
        const expectedOrigin = config.publicOrigin ?? `${config.cookieSecure ? 'https' : 'http'}://${context.req.header('host')}`
        if (originHeader !== expectedOrigin) {
          return context.json({ error: 'forbidden', message: 'Cross-origin request refused.' }, 403)
        }
      }
    }
    await next()
  })

  // ---------- public API ----------

  app.get('/api/status', (context) => {
    const status: AuthStatus = {
      claimed: account.isInitialized(),
      signedIn: sessions.touch(getCookie(context, sessionCookieName)) !== null,
      totpEnabled: account.isTotpEnabled(),
      sessionIdleMinutes: config.sessionIdleMinutes,
    }
    return context.json(status)
  })

  app.post('/api/setup', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const setupRequest = await readJsonBody(context, setupRequestSchema)
    if (account.isInitialized()) throw new AuthError('already_claimed', 'This instance is already set up.')
    if (setupRequest.setupToken.trim() !== config.setupToken) {
      unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw new AuthError('wrong_setup_token', 'That setup token is not right. Check the server log.')
    }
    await account.initialize(setupRequest.passphrase)
    audit(context, 'instance_claimed')
    startSession(context)
    return context.json({ ok: true }, 201)
  })

  app.post('/api/login', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const loginRequest = await readJsonBody(context, loginRequestSchema)
    try {
      await account.unlock(loginRequest.passphrase, loginRequest.totpCode)
      unlockRateLimiter.recordSuccess(clientIpAddress(context))
      audit(context, 'signed_in')
      startSession(context)
      return context.json({ ok: true })
    } catch (error) {
      if (error instanceof AuthError && (error.code === 'wrong_credentials' || error.code === 'totp_required')) {
        unlockRateLimiter.recordFailure(clientIpAddress(context))
        audit(context, 'sign_in_failed')
      }
      throw error
    }
  })

  app.post('/api/logout', (context) => {
    if (sessions.touch(getCookie(context, sessionCookieName))) audit(context, 'signed_out')
    endSession(context)
    return context.json({ ok: true })
  })

  // ---------- everything below requires a signed-in session ----------

  app.use('/api/*', async (context, next) => {
    if (sessions.touch(getCookie(context, sessionCookieName)) === null) {
      throw new AuthError('not_signed_in', 'Sign in first.')
    }
    await next()
  })

  app.get('/api/summary', (context) => {
    const status: Status = {
      ok: true,
      fabricCount: fabrics.count(),
      patternCount: patterns.count(),
      notionCount: notions.count(),
      threadCount: threads.count(),
      toolCount: tools.count(),
      projectCount: projects.count(),
    }
    return context.json(status)
  })

  app.get('/api/audit', (context) => context.json(auditLog.listRecent(100)))

  // Export — everything in one zip: the records as JSON, the photos as files.
  app.get('/api/export', (context) => {
    const stamp = nowIso().slice(0, 10)
    const { zip } = buildExportZip(database, nowIso())
    audit(context, 'exported')
    context.header('Content-Type', 'application/zip')
    context.header('Content-Disposition', `attachment; filename="boltbook-${stamp}.zip"`)
    return context.body(new Uint8Array(zip))
  })

  // Import — restore an export. Replaces every record, so it must be asked for.
  app.post('/api/import', async (context) => {
    if (context.req.query('mode') !== 'replace') {
      throw new RecordValidationError('A restore replaces every record, so it must be asked for: POST with ?mode=replace.')
    }
    const zip = Buffer.from(await context.req.arrayBuffer())
    if (zip.byteLength === 0) throw new RecordValidationError('The upload was empty.')
    const result = importExport(database, zip)
    audit(context, 'imported')
    return context.json({ ok: true, imported: result.tables, photos: result.photoCount })
  })

  app.post('/api/passphrase', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const changeRequest = await readJsonBody(context, passphraseChangeRequestSchema)
    try {
      await account.changePassphrase(changeRequest.currentPassphrase, changeRequest.newPassphrase)
    } catch (error) {
      if (error instanceof AuthError && error.code === 'wrong_credentials') unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw error
    }
    // Sign out every other device; keep this one.
    sessions.destroyAll()
    audit(context, 'passphrase_changed')
    startSession(context)
    return context.json({ ok: true })
  })

  app.post('/api/totp/begin', (context) => {
    const session = sessions.touch(getCookie(context, sessionCookieName))
    const { secret, secretBase32 } = account.createPendingTotpSecret()
    if (session) {
      session.pendingTotpSecret?.fill(0)
      session.pendingTotpSecret = secret
    } else {
      secret.fill(0)
    }
    return context.json({ secretBase32, otpauthUri: buildOtpauthUri(secretBase32, 'boltbook', 'boltbook') })
  })

  app.post('/api/totp/confirm', async (context) => {
    const session = sessions.touch(getCookie(context, sessionCookieName))
    const { code } = await readJsonBody(context, totpConfirmRequestSchema)
    if (!session?.pendingTotpSecret) throw new AuthError('totp_not_pending', 'Start setup again to get a new secret.')
    account.confirmTotpEnrollment(session.pendingTotpSecret, code)
    session.pendingTotpSecret.fill(0)
    session.pendingTotpSecret = null
    audit(context, 'authenticator_enabled')
    return context.json({ ok: true })
  })

  app.post('/api/totp/disable', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const confirmation = await readJsonBody(context, passphraseConfirmationSchema)
    try {
      if (!(await account.verifyPassphrase(confirmation.passphrase))) {
        throw new AuthError('wrong_credentials', 'That passphrase is not right.')
      }
    } catch (error) {
      if (error instanceof AuthError && error.code === 'wrong_credentials') unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw error
    }
    account.disableTotp()
    audit(context, 'authenticator_disabled')
    return context.json({ ok: true })
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
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
    const units = unitsOf(context)
    return context.json(fabrics.list(filters).map((fabric) => presentMeasures(fabric, FABRIC_MEASURES, units)))
  })

  app.post('/api/fabrics', async (context) => {
    const input = await readMeasuredBody(context, fabricInputSchema, FABRIC_MEASURES)
    assertFabricInvariant(input)
    return context.json(presentMeasures(fabrics.create(input, nowIso()), FABRIC_MEASURES, unitsOf(context)), 201)
  })

  app.get('/api/fabrics/:fabricId', (context) => {
    const fabric = fabrics.get(context.req.param('fabricId'))
    if (!fabric) throw new RecordNotFoundError('No such fabric.')
    return context.json(presentMeasures(fabric, FABRIC_MEASURES, unitsOf(context)))
  })

  app.put('/api/fabrics/:fabricId', async (context) => {
    const input = await readMeasuredBody(context, fabricInputSchema, FABRIC_MEASURES)
    assertFabricInvariant(input)
    return context.json(presentMeasures(fabrics.replace(context.req.param('fabricId'), input, nowIso()), FABRIC_MEASURES, unitsOf(context)))
  })

  app.delete('/api/fabrics/:fabricId', (context) => {
    fabrics.delete(context.req.param('fabricId'))
    return context.json({ ok: true })
  })

  // Fabric photos — one image per request, raw bytes, downscaled and EXIF-stripped client-side.

  app.post('/api/fabrics/:fabricId/photos', async (context) => {
    const contentType = (context.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!ALLOWED_PHOTO_TYPES.has(contentType)) throw new RecordValidationError('Photos must be JPEG, PNG or WebP.')
    const bytes = Buffer.from(await context.req.arrayBuffer())
    if (bytes.byteLength === 0) throw new RecordValidationError('The photo is empty.')
    if (bytes.byteLength > MAX_PHOTO_BYTES) throw new RecordValidationError('The photo is larger than 8 MB.')
    const widthPx = optionalIntegerQuery(context, 'widthPx', 20_000)
    const heightPx = optionalIntegerQuery(context, 'heightPx', 20_000)
    return context.json(fabrics.addPhoto(context.req.param('fabricId'), { contentType, bytes, widthPx, heightPx }, nowIso()), 201)
  })

  app.get('/api/fabrics/:fabricId/photos/:photoId', (context) => {
    const photo = fabrics.getPhotoBytes(context.req.param('fabricId'), context.req.param('photoId'))
    if (!photo) throw new RecordNotFoundError('No such photo.')
    context.header('Content-Type', photo.contentType)
    context.header('Content-Disposition', 'inline')
    // The id is the cache key: a replaced photo gets a new id, so this never serves stale bytes.
    context.header('Cache-Control', 'public, max-age=31536000, immutable')
    return context.body(new Uint8Array(photo.bytes))
  })

  app.delete('/api/fabrics/:fabricId/photos/:photoId', (context) => {
    fabrics.deletePhoto(context.req.param('fabricId'), context.req.param('photoId'))
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
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
    const units = unitsOf(context)
    return context.json(patterns.list(filters).map((pattern) => presentPattern(pattern, units)))
  })

  app.post('/api/patterns', async (context) => {
    const input = await readJsonBody(context, patternInputSchema)
    return context.json(presentPattern(patterns.create(input, nowIso()), unitsOf(context)), 201)
  })

  app.get('/api/patterns/:patternId', (context) => {
    const pattern = patterns.get(context.req.param('patternId'))
    if (!pattern) throw new RecordNotFoundError('No such pattern.')
    return context.json(presentPattern(pattern, unitsOf(context)))
  })

  app.put('/api/patterns/:patternId', async (context) => {
    const input = await readJsonBody(context, patternInputSchema)
    return context.json(presentPattern(patterns.replace(context.req.param('patternId'), input, nowIso()), unitsOf(context)))
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
    const input = await readMeasuredBody(context, patternRequirementInputSchema, REQUIREMENT_MEASURES)
    const requirement = patterns.addRequirement(context.req.param('patternId'), context.req.param('viewId'), input, nowIso())
    return context.json(presentMeasures(requirement as unknown as Record<string, unknown>, REQUIREMENT_MEASURES, unitsOf(context)), 201)
  })

  app.put('/api/patterns/:patternId/views/:viewId/requirements/:requirementId', async (context) => {
    const input = await readMeasuredBody(context, patternRequirementInputSchema, REQUIREMENT_MEASURES)
    const requirement = patterns.replaceRequirement(
      context.req.param('patternId'),
      context.req.param('viewId'),
      context.req.param('requirementId'),
      input,
      nowIso(),
    )
    return context.json(presentMeasures(requirement as unknown as Record<string, unknown>, REQUIREMENT_MEASURES, unitsOf(context)))
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
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
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
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
    const units = unitsOf(context)
    return context.json(threads.list(filters).map((thread) => presentMeasures(thread, THREAD_MEASURES, units)))
  })

  app.post('/api/threads', async (context) => {
    const input = await readMeasuredBody(context, threadInputSchema, THREAD_MEASURES)
    assertThreadInvariant(input)
    return context.json(presentMeasures(threads.create(input, nowIso()), THREAD_MEASURES, unitsOf(context)), 201)
  })

  app.get('/api/threads/:threadId', (context) => {
    const thread = threads.get(context.req.param('threadId'))
    if (!thread) throw new RecordNotFoundError('No such thread.')
    return context.json(presentMeasures(thread, THREAD_MEASURES, unitsOf(context)))
  })

  app.put('/api/threads/:threadId', async (context) => {
    const input = await readMeasuredBody(context, threadInputSchema, THREAD_MEASURES)
    assertThreadInvariant(input)
    return context.json(presentMeasures(threads.replace(context.req.param('threadId'), input, nowIso()), THREAD_MEASURES, unitsOf(context)))
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
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
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

  // Project (with allocations and the shortfall readout)

  app.get('/api/projects', (context) => {
    const filters: ProjectFilters = {}
    const status = context.req.query('status')
    if (status) {
      if (!PROJECT_STATUSES.includes(status as ProjectStatus)) throw new RecordValidationError('Unknown project status.')
      filters.status = status as ProjectStatus
    }
    const tag = context.req.query('tag')
    if (tag) filters.tag = tag
    const units = unitsOf(context)
    return context.json(projects.list(filters).map((project) => presentProject(project, units)))
  })

  app.post('/api/projects', async (context) => {
    const input = await readJsonBody(context, projectInputSchema)
    return context.json(presentProject(projects.create(input, nowIso()), unitsOf(context)), 201)
  })

  app.get('/api/projects/:projectId', (context) => {
    const project = projects.get(context.req.param('projectId'))
    if (!project) throw new RecordNotFoundError('No such project.')
    return context.json(presentProject(project, unitsOf(context)))
  })

  app.put('/api/projects/:projectId', async (context) => {
    const input = await readJsonBody(context, projectInputSchema)
    return context.json(presentProject(projects.replace(context.req.param('projectId'), input, nowIso()), unitsOf(context)))
  })

  app.delete('/api/projects/:projectId', (context) => {
    projects.delete(context.req.param('projectId'))
    return context.json({ ok: true })
  })

  app.put('/api/projects/:projectId/allocations', async (context) => {
    const raw = (await context.req.json().catch(() => ({}))) as {
      fabrics?: Array<Record<string, unknown>>
      threads?: Array<Record<string, unknown>>
      notions?: Array<Record<string, unknown>>
    }
    const input = allocationsInputSchema.parse({
      fabrics: (raw.fabrics ?? []).map((entry) => normalizeMeasures(entry, FABRIC_ALLOCATION_MEASURES)),
      threads: (raw.threads ?? []).map((entry) => normalizeMeasures(entry, THREAD_ALLOCATION_MEASURES)),
      notions: raw.notions ?? [],
    })
    return context.json(presentProject(projects.setAllocations(context.req.param('projectId'), input, nowIso()), unitsOf(context)))
  })

  app.get('/api/projects/:projectId/shortfall', (context) => {
    const lines: ShortfallLine[] = projects.shortfall(context.req.param('projectId'))
    return context.json(presentShortfallLines(lines, unitsOf(context)))
  })

  // Tags — one vocabulary, shared by every record

  app.get('/api/tags', (context) => context.json(tags.listAll()))

  app.post('/api/tags', async (context) => {
    const input = await readJsonBody(context, tagInputSchema)
    return context.json(tags.create(input.name, nowIso()), 201)
  })

  app.delete('/api/tags/:tagId', (context) => {
    tags.delete(context.req.param('tagId'))
    return context.json({ ok: true })
  })

  // Search

  app.get('/api/search', (context) => {
    const query = context.req.query('q') ?? ''
    const hits: SearchHit[] = searchAll(database, query)
    return context.json(hits)
  })

  app.all('/api/*', (context) => context.json({ error: 'not_found', message: 'No such endpoint.' }, 404))

  // ---------- static client ----------

  app.get('*', (context) => {
    const staticAssets = dependencies.staticAssets
    const requestedPath = context.req.path
    const asset = staticAssets?.get(requestedPath) ?? staticAssets?.get('/index.html')
    if (!staticAssets || !asset) return context.text('Client not built. Run npm run build.', 503)
    context.header('Content-Type', asset.contentType)
    // Fingerprinted assets are immutable; index.html must never be cached.
    const isFingerprintedRequest = staticAssets.has(requestedPath) && asset.isFingerprinted
    context.header('Cache-Control', isFingerprintedRequest ? 'public, max-age=31536000, immutable' : 'no-cache')
    return context.body(new Uint8Array(asset.body))
  })

  // ---------- errors ----------

  app.onError((error, context) => {
    if (error instanceof AuthError) {
      return context.json({ error: error.code, message: error.message }, STATUS_BY_AUTH_ERROR[error.code])
    }
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

  return { app, account, sessions, fabrics, patterns, notions, threads, tools, projects, tags }
}
