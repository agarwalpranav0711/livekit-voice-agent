import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp, readConfig } from './index.js'

const config = readConfig({
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret',
  WEB_ACCESS_PASSWORD: 'a-secure-test-passphrase-with-32-chars',
  WEB_ORIGIN: 'http://localhost:5173',
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
  TRUST_PROXY_HOPS: '0',
})

const server = createApp(config).listen(0, '127.0.0.1')
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve)
  server.once('error', reject)
})

const address = server.address() as AddressInfo
const baseUrl = `http://127.0.0.1:${address.port}`
const requests = new AbortController()
after(() => {
  requests.abort()
  server.close()
})

async function issueToken(accessCode: string, origin = config.WEB_ORIGIN) {
  return fetch(`${baseUrl}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ accessCode }),
    signal: requests.signal,
  })
}

test('health endpoint reports availability without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { signal: requests.signal })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('token endpoint rejects requests from a different origin', async () => {
  const response = await issueToken(config.WEB_ACCESS_PASSWORD, 'https://untrusted.example')
  assert.equal(response.status, 403)
})

test('token endpoint rejects an incorrect access code', async () => {
  const response = await issueToken('an-incorrect-access-code-that-is-long-enough')
  assert.equal(response.status, 401)
})

test('token endpoint rejects missing or malformed request data', async () => {
  const response = await fetch(`${baseUrl}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: config.WEB_ORIGIN },
    body: JSON.stringify({ roomName: 'caller-controlled-room' }),
    signal: requests.signal,
  })
  assert.equal(response.status, 400)
})

test('token endpoint issues a short-lived microphone-only token for a fresh room', async () => {
  const response = await issueToken(config.WEB_ACCESS_PASSWORD)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')

  const payload = await response.json() as {
    serverUrl: string
    token: string
    roomName: string
    identity: string
    expiresInSeconds: number
  }
  assert.equal(payload.serverUrl, config.LIVEKIT_URL)
  assert.match(payload.roomName, /^web-[0-9a-f-]{36}$/)
  assert.match(payload.identity, /^guest-[0-9a-f-]{36}$/)
  assert.equal(payload.expiresInSeconds, 600)
  assert.equal(JSON.stringify(payload).includes(config.LIVEKIT_API_SECRET), false)

  const claims = JSON.parse(Buffer.from(payload.token.split('.')[1], 'base64url').toString()) as {
    sub: string
    exp: number
    nbf: number
    video: {
      room: string
      roomJoin: boolean
      canPublish: boolean
      canPublishSources: string[]
      canPublishData: boolean
      canSubscribe: boolean
    }
  }
  assert.equal(claims.sub, payload.identity)
  assert.equal(claims.video.room, payload.roomName)
  assert.equal(claims.video.roomJoin, true)
  assert.equal(claims.video.canPublish, true)
  assert.deepEqual(claims.video.canPublishSources, ['microphone'])
  assert.equal(claims.video.canPublishData, false)
  assert.equal(claims.video.canSubscribe, true)
  assert.ok(claims.exp - claims.nbf <= 600)
  assert.equal(Object.hasOwn(claims, 'roomConfig'), false)
})

test('token endpoint rate limits repeated attempts', async () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await issueToken(config.WEB_ACCESS_PASSWORD)
    assert.equal(response.status, 200)
  }

  const response = await issueToken(config.WEB_ACCESS_PASSWORD)
  assert.equal(response.status, 429)
})

test('configuration errors identify missing names without exposing values', () => {
  assert.throws(
    () => readConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /LIVEKIT_API_SECRET/)
      assert.doesNotMatch(error.message, /devsecret/)
      return true
    },
  )
})
