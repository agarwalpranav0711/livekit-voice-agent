# Aural web client

This React + Vite + TypeScript app connects to the existing Python LiveKit
Agents worker. It uses LiveKit's official browser SDK and a small Express API
that issues short-lived participant tokens. No AI or LiveKit API secret is
included in the Vite client bundle.

## Before you start

- Node.js 22.22 or newer and npm.
- Python agent configured with the same LiveKit Cloud project as the API.
- The project's root `.env` file containing `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  and `LIVEKIT_API_SECRET`. The API reads this ignored file from the parent
  project folder; it never sends the API key or secret to the browser.
- A browser with microphone support. Microphone access requires HTTPS or
  `localhost`.

The agent in `agent.py` uses `@server.rtc_session()` without an `agent_name`.
LiveKit documents this as automatic dispatch: an unnamed agent is dispatched
when a new room is created. The API generates a different random room name for
each call, and the first browser participant creates that room. This is why the
agent worker must already be registered in the same LiveKit project. The API
does not add a named-agent dispatch to the token; doing so would not target the
currently unnamed worker. LiveKit recommends named, explicit dispatch for
production systems, but switching requires changing and redeploying the worker.

## Local configuration

From this folder, make the private API settings file once:

```powershell
Copy-Item .env.example .env
```

Edit `voice-agent-web/.env` and set `WEB_ACCESS_PASSWORD` to a random value at
least 24 characters long. To generate one locally:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Paste the generated value into that local `.env` file. Keep it private. The API
checks this access code, rate-limits token requests, validates the website
origin, and only grants access to one server-generated room. The access code is
not persisted in browser storage.

`WEB_ORIGIN` must match the exact address used in the browser. The default is
`http://localhost:5173`; use that exact hostname rather than `127.0.0.1`.

## Run the project

Install the frontend and API packages once:

```powershell
npm ci
```

Open three PowerShell terminals in the project root
(`D:\n8n AI agnets\voice agent\livekit-voice-agent`):

**Terminal 1 — Python agent.** If the worker is already registered and healthy,
leave it alone; do not restart it. Otherwise run:

```powershell
uv run agent.py dev
```

**Terminal 2 — Secure token API:**

```powershell
Set-Location .\voice-agent-web
npm run dev:api
```

**Terminal 3 — Website:**

```powershell
Set-Location .\voice-agent-web
npm run dev
```

Open `http://localhost:5173`, enter the access code from the API `.env`, and
choose **Start talking**. The browser will ask for microphone permission. The
website reports when it has joined LiveKit and whether the Python agent joins
the new room; if it does not arrive within 20 seconds, check the agent worker
and its LiveKit project configuration. Use **Mute** or **End conversation** to
control the live session.

The transcript appears only if the connected agent publishes LiveKit
transcription events. The existing agent may provide audio without publishing
transcripts.

## Server API

The API listens on `127.0.0.1:3001` by default:

- `GET /api/health` reports API process health without returning configuration.
- `POST /api/token` requires the exact allowed `Origin` and JSON
  `{ "accessCode": "..." }`.

Tokens expire after 10 minutes, are not cacheable, and are limited to a random
room and guest identity. They grant room join, subscribe, and microphone
publishing only; data publishing is disabled. Token creation is rate-limited
to 8 requests per IP per 15 minutes. The rate limiter is in-memory and is
intended for local development, not a multi-instance production deployment.

## Checks

Run these from `voice-agent-web`:

```powershell
npm run build
npm test
npm run lint
```

These checks do not connect to LiveKit, open a microphone, or prove a spoken
conversation. Those require a running worker, valid Cloud credentials, a
supported browser, and microphone permission.

## Production notes

This is a local-development integration, not a production authentication
system. The shared access code is suitable for a private prototype only. A
public deployment needs real user authentication, HTTPS, an exact production
`WEB_ORIGIN`, secret injection from a hosting provider, and a shared,
distributed rate limiter. Put the static Vite build and API behind the same
HTTPS origin (or configure a specific HTTPS origin and reverse proxy `/api`).
If the API is behind exactly one trusted reverse proxy, set
`TRUST_PROXY_HOPS=1`; do not expose the API directly to untrusted clients when
trust proxy is enabled, or IP-based rate limits could be bypassed.

Live audio uses your LiveKit project and configured inference providers; their
usage may incur charges.
