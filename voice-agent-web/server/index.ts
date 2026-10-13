import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { z } from 'zod'

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
  const result = configSchema.safeParse(environment)
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

export function createApp(config: ServerConfig) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.TRUST_PROXY_HOPS)
  app.use(helmet())
  app.use(cors({
    origin: config.WEB_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }))
  app.use(express.json({ limit: '2kb', strict: true }))

  const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: 'Too many connection attempts. Wait a few minutes and try again.' })
    },
  })

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/api/token', tokenLimiter, async (request: Request, response: Response) => {
    if (request.get('origin') !== config.WEB_ORIGIN) {
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

    try {
      const token = await createRoomToken(config, roomName, identity)
      response.setHeader('Cache-Control', 'no-store')
      response.json({
        serverUrl: config.LIVEKIT_URL,
        roomName,
        identity,
        token,
        expiresInSeconds: 600,
      })
    } catch (error) {
      console.error(
        'LiveKit token signing failed (%s).',
        error instanceof Error ? error.name : 'unknown error',
      )
      response.status(503).json({ error: 'Could not create a LiveKit session. Check the server configuration and try again.' })
    }
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
