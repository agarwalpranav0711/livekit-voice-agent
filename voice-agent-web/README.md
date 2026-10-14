# Aural web client

This React + Vite + TypeScript app connects to the existing Python LiveKit
Agents worker. It uses LiveKit's official browser SDK and a small Express API
that issues short-lived participant tokens. No AI or LiveKit API secret is
included in the Vite client bundle.

## Before you start

- Node.js 22.22 or newer and npm. Local SQLite uses Node's built-in
  `node:sqlite`; Node 22 may display its experimental-feature warning.
- Python agent configured with the same LiveKit Cloud project as the API.
- The project's root `.env` file containing `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  and `LIVEKIT_API_SECRET`. The API reads this ignored file from the parent
  project folder; it never sends the API key or secret to the browser.
- A browser with microphone support. Microphone access requires HTTPS or
  `localhost`.

The agent in `agent.py` uses `@server.rtc_session()` without an `agent_name`.
LiveKit documents this as automatic dispatch: an unnamed agent is dispatched
when a participant joins a new room. The API creates a random room first and
places the validated assistant settings snapshot in its room metadata; the
browser then joins it. The Python worker must already be running in the same
LiveKit project. The API does not add a named-agent dispatch to the token.

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

Paste the generated value into that local `.env` file. Keep it private. The API checks this access code, rate-limits token requests, validates the
website origin, and only grants access to one server-generated room. The code
is not persisted in browser storage. Settings and history use the same code to
unlock a signed, HttpOnly, same-site owner session.

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

Open `http://localhost:5173`. Use **Settings** to personalize the assistant
and **History** to review saved conversations; both ask for the access code
when needed. Then enter that code in the voice page and choose **Start
talking**. The browser will ask for microphone permission. The website reports
whether the Python agent joins the new room; if it does not arrive within 20
seconds, check the worker and its LiveKit project configuration. Use **Mute**
or **End conversation** to control the live session.

Settings persist locally in `voice-agent-web/data/aural.sqlite`. Each new room
receives the saved settings in its initial LiveKit room metadata; `agent.py`
reads that snapshot to build the actual agent instructions and speak the
configured greeting. Changes apply to the next session, not an ongoing one.

Only final LiveKit `TranscriptionReceived` events are saved. If the agent does
not publish transcript events, history retains session metadata and displays
an empty-transcript state; no transcript is invented. Raw microphone audio is
not saved. Explicitly ended sessions are marked completed; a browser closed
abruptly may leave the record incomplete. Data is local to this laptop and
scoped to the signed owner session cookie. The UI can delete individual
records or clear all of them; the access code itself is never stored.

## Server API

The API listens on `127.0.0.1:3001` by default. The Vite development server
listens on the laptop's network interfaces and proxies `/api` requests to the
API on that same laptop:

- `GET /api/health` reports API process health without returning configuration.
- `POST /api/session` validates the access code and creates a private
  owner-scoped browser session.
- `GET/PUT /api/settings` load and validate locally stored assistant settings.
- `/api/history` endpoints list, read, and delete only the current owner's
  conversations and actual transcript events.
- `POST /api/token` requires the exact allowed `Origin` and JSON
  `{ "accessCode": "..." }`. The API creates a new room with the settings
  snapshot in metadata before returning its room-scoped token.

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

## Phone testing on your local network

See the repository's
[`LOCAL_DEVELOPMENT.md`](../LOCAL_DEVELOPMENT.md) for the laptop and phone
commands, the browser HTTPS/microphone limitation, and temporary tunnel
precautions. A same-Wi-Fi `http://<laptop-ip>:5173` URL can load the site, but
is not a secure context for microphone access on a phone. A temporary HTTPS
tunnel exposes the development site through a public URL while it is running;
get approval before installing or downloading a tunnel tool.

This remains a private learning project. Keep the access code and LiveKit
credentials private. LiveKit audio/inference usage may incur charges.
