import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import { z } from 'zod'
import { assistantSettingsSchema } from './settings.js'
import { LocalStore, type TranscriptInput } from './store.js'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: resolve(webRoot, '../.env') })
dotenv.config({ path: resolve(webRoot, '.env') })

const configSchema = z.object({
  LIVEKIT_URL: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'wss:' || (protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(new URL(value).hostname))
  }, 'must be a secure WebSocket URL (wss), or a local ws URL'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  WEB_ACCESS_PASSWORD: z.string().min(24),
  WEB_ORIGIN: z.string().url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value
  }, 'must be an origin without a path'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
})

export type ServerConfig = z.infer<typeof configSchema>

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = configSchema.safeParse({
    ...environment,
    API_HOST: environment.API_HOST ?? (environment.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    API_PORT: environment.API_PORT ?? environment.PORT ?? '3001',
  })
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = String(issue.path[0] ?? 'configuration')
      return `${field}: ${issue.message}`
    })
    throw new Error(`Invalid API configuration. Set/fix: ${issues.join('; ')}`)
  }
  return result.data
}

function secretsMatch(supplied: string, expected: string) {
  const suppliedDigest = createHash('sha256').update(supplied).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(suppliedDigest, expectedDigest)
}

function createRoomToken(config: ServerConfig, roomName: string, identity: string) {
  const accessToken = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity,
    ttl: '10m',
  })

  accessToken.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: true,
  })

  return accessToken.toJwt()
}

const requestSchema = z.object({
  accessCode: z.string().min(24).max(256),
}).strict()

const transcriptSchema = z.object({
  segments: z.array(z.object({
    segmentId: z.string().min(1).max(200),
    speaker: z.enum(['You', 'Assistant', 'Participant']),
    text: z.string().trim().min(1).max(2000),
  }).strict()).max(32),
}).strict()
const conversationIdSchema = z.string().regex(/^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

const roomServiceAdapter = {
  createRoom: async (config: ServerConfig, name: string, metadata: string) => {
    const url = new URL(config.LIVEKIT_URL)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    const service = new RoomServiceClient(url.toString(), config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
    await service.createRoom({ name, metadata })
  },
}

function createOwnerCookie(config: ServerConfig, ownerId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90
  const payload = `${ownerId}.${expiresAt}`
  const signature = createHmac('sha256', config.WEB_ACCESS_PASSWORD).update(payload).digest('base64url')
  const secure = new URL(config.WEB_ORIGIN).protocol === 'https:' ? '; Secure' : ''
  return `aural_session=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000${secure}`
}

function readOwnerId(request: Request, config: ServerConfig) {
  const cookieHeader = request.get('cookie') ?? ''
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith('aural_session='))
  const value = cookie?.slice('aural_session='.length)
  if (!value) return null

  const [ownerId, expiryText, signature, extra] = value.split('.')
  if (!ownerId || !expiryText || !signature || extra !== undefined || !/^[0-9a-f-]{36}$/.test(ownerId)) return null
  const expiresAt = Number(expiryText)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null

  const expected = createHmac('sha256', config.WEB_ACCESS_PASSWORD)
    .update(`${ownerId}.${expiresAt}`)
    .digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  return supplied.length === expected.length && timingSafeEqual(expected, supplied) ? ownerId : null
}

function requireOwner(request: Request, response: Response, config: ServerConfig) {
  const ownerId = readOwnerId(request, config)
  if (!ownerId) {
    response.status(401).json({ error: 'Unlock your private settings and history with the access code.' })
    return null
  }
  return ownerId
}

function hasAllowedOrigin(request: Request, config: ServerConfig) {
  return request.get('origin') === config.WEB_ORIGIN
}

export function createApp(
  config: ServerConfig,
  dependencies: {
    store?: LocalStore
    createRoom?: (name: string, metadata: string) => Promise<void>
    tokenLimit?: number
  } = {},
) {
  const app = express()
  const store = dependencies.store ?? new LocalStore()
  const createRoom = dependencies.createRoom ?? ((name, metadata) => roomServiceAdapter.createRoom(config, name, metadata))
  const livekitUrl = new URL(config.LIVEKIT_URL)
  const livekitHttpProtocol = livekitUrl.protocol === 'wss:' ? 'https:' : 'http:'
  app.disable('x-powered-by')
  app.set('trust proxy', config.TRUST_PROXY_HOPS)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: [
          "'self'",
          `${livekitUrl.protocol}//${livekitUrl.host}`,
          `${livekitHttpProtocol}//${livekitUrl.host}`,
        ],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }))
  app.use((_request, response, next) => {
    response.setHeader('Permissions-Policy', 'microphone=(self), camera=()')
    next()
  })
  app.use(cors({
    origin: config.WEB_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }))
  app.use(express.json({ limit: '96kb', strict: true }))

  const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: dependencies.tokenLimit ?? 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: 'Too many connection attempts. Wait a few minutes and try again.' })
    },
  })
  const accessLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
  })

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/api/session', accessLimiter, (request: Request, response: Response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to unlock private data.' })
      return
    }
    const body = requestSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: 'Enter the access code to unlock private data.' })
      return
    }
    if (!secretsMatch(body.data.accessCode, config.WEB_ACCESS_PASSWORD)) {
      response.status(401).json({ error: 'The access code was not accepted.' })
      return
    }
    const ownerId = randomUUID()
    response.setHeader('Set-Cookie', createOwnerCookie(config, ownerId))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ authenticated: true })
  })

  app.get('/api/settings', (request, response) => {
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    try {
      response.setHeader('Cache-Control', 'no-store')
      response.json(store.getSettings(ownerId))
    } catch {
      response.status(500).json({ error: 'Could not load assistant settings from local storage.' })
    }
  })

  app.put('/api/settings', (request, response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to update settings.' })
      return
    }
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    const parsed = assistantSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        error: 'Some settings are invalid. Check the highlighted values and remove any requests for private configuration.',
        fields: parsed.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ''), message: issue.message })),
      })
      return
    }
    try {
      response.setHeader('Cache-Control', 'no-store')
      response.json(store.saveSettings(ownerId, parsed.data))
    } catch {
      response.status(500).json({ error: 'Could not save assistant settings to local storage.' })
    }
  })

  app.get('/api/history', (request, response) => {
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    try {
      response.setHeader('Cache-Control', 'no-store')
      response.json({ conversations: store.listConversations(ownerId) })
    } catch {
      response.status(500).json({ error: 'Could not load conversation history from local storage.' })
    }
  })

  app.get('/api/history/:conversationId', (request, response) => {
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    const conversationId = conversationIdSchema.safeParse(request.params.conversationId)
    if (!conversationId.success) {
      response.status(400).json({ error: 'That conversation id is invalid.' })
      return
    }
    try {
      const conversation = store.getConversation(ownerId, conversationId.data)
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found.' })
        return
      }
      response.setHeader('Cache-Control', 'no-store')
      response.json({ conversation })
    } catch {
      response.status(500).json({ error: 'Could not load that conversation from local storage.' })
    }
  })

  app.delete('/api/history', (request, response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to delete history.' })
      return
    }
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    try {
      response.json({ deleted: store.clearConversations(ownerId) })
    } catch {
      response.status(500).json({ error: 'Could not clear conversation history.' })
    }
  })

  app.delete('/api/history/:conversationId', (request, response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to delete history.' })
      return
    }
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    const conversationId = conversationIdSchema.safeParse(request.params.conversationId)
    if (!conversationId.success) {
      response.status(400).json({ error: 'That conversation id is invalid.' })
      return
    }
    try {
      if (!store.deleteConversation(ownerId, conversationId.data)) {
        response.status(404).json({ error: 'Conversation not found.' })
        return
      }
      response.json({ deleted: true })
    } catch {
      response.status(500).json({ error: 'Could not delete that conversation.' })
    }
  })

  app.post('/api/history/:conversationId/transcript', (request, response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to save transcript entries.' })
      return
    }
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    const conversationId = conversationIdSchema.safeParse(request.params.conversationId)
    const body = transcriptSchema.safeParse(request.body)
    if (!conversationId.success || !body.success) {
      response.status(400).json({ error: 'The transcript update is invalid.' })
      return
    }
    try {
      const written = store.addTranscript(ownerId, conversationId.data, body.data.segments as TranscriptInput[])
      if (!store.getConversation(ownerId, conversationId.data)) {
        response.status(404).json({ error: 'Conversation not found.' })
        return
      }
      response.json({ saved: written })
    } catch {
      response.status(500).json({ error: 'Could not save transcript entries to local storage.' })
    }
  })

  app.post('/api/history/:conversationId/finish', (request, response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to update conversation status.' })
      return
    }
    const ownerId = requireOwner(request, response, config)
    if (!ownerId) return
    const conversationId = conversationIdSchema.safeParse(request.params.conversationId)
    if (!conversationId.success) {
      response.status(400).json({ error: 'That conversation id is invalid.' })
      return
    }
    try {
      if (!store.finishConversation(ownerId, conversationId.data)) {
        response.status(404).json({ error: 'Conversation not found.' })
        return
      }
      response.json({ completed: true })
    } catch {
      response.status(500).json({ error: 'Could not update conversation status.' })
    }
  })

  app.post('/api/token', tokenLimiter, async (request: Request, response: Response) => {
    if (!hasAllowedOrigin(request, config)) {
      response.status(403).json({ error: 'This website is not allowed to request a session.' })
      return
    }

    const body = requestSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: 'Enter the access code to start a session.' })
      return
    }

    if (!secretsMatch(body.data.accessCode, config.WEB_ACCESS_PASSWORD)) {
      response.status(401).json({ error: 'The access code was not accepted.' })
      return
    }

    const roomName = `web-${randomUUID()}`
    const identity = `guest-${randomUUID()}`
    const ownerId = readOwnerId(request, config) ?? randomUUID()

    try {
      const settings = store.getSettings(ownerId).settings
      const token = await createRoomToken(config, roomName, identity)
      store.createConversation(ownerId, roomName, settings)
      const roomMetadata = JSON.stringify({
        aural: {
          conversationId: roomName,
          assistantSettings: settings,
        },
      })
      await createRoom(roomName, roomMetadata)
      response.setHeader('Set-Cookie', createOwnerCookie(config, ownerId))
      response.setHeader('Cache-Control', 'no-store')
      response.json({
        serverUrl: config.LIVEKIT_URL,
        roomName,
        identity,
        token,
        expiresInSeconds: 600,
      })
    } catch (error) {
      store.deleteConversation(ownerId, roomName)
      console.error(
        'Conversation setup failed (%s).',
        error instanceof Error ? error.name : 'unknown error',
      )
      response.status(503).json({ error: 'Could not prepare this conversation. Check local storage and LiveKit configuration, then try again.' })
    }
  })

  const clientBuildPath = resolve(webRoot, 'dist')
  app.use(express.static(clientBuildPath, { index: false, maxAge: '1h' }))
  app.use((request, response, next) => {
    if (
      request.method !== 'GET'
      || request.path === '/api'
      || request.path.startsWith('/api/')
      || !request.accepts('html')
    ) {
      next()
      return
    }

    response.sendFile(resolve(clientBuildPath, 'index.html'), (error) => {
      if (error) next(error)
    })
  })

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : 500

    if (status >= 500) {
      console.error('API request failed.')
      response.status(500).json({ error: 'The API could not process this request.' })
      return
    }

    response.status(status === 413 ? 413 : 400).json({
      error: status === 413 ? 'Request body is too large.' : 'Invalid request.',
    })
  }
  app.use(handleError)

  return app
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = readConfig()
    createApp(config).listen(config.API_PORT, config.API_HOST, () => {
      console.info(`Voice agent API listening on http://${config.API_HOST}:${config.API_PORT}`)
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not start the API server.')
    process.exitCode = 1
  }
}
