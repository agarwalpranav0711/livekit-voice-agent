# Local development only

The current goal is to learn and test from your laptop. This plan does not
deploy the website, create hosting resources, or configure telephony. The
existing Python agent, website, backend, local model/cache files, and private
environment files are left in place. Source code may be shared through GitHub;
private environment files and local conversation data must remain untracked.

## Current readiness

- The project includes the React site, token API, Python agent, customizable
  assistant settings, local conversation history, and automated tests.
- The website API reads the LiveKit credentials and access code from ignored
  `.env` files. Keep those private; do not put any value in frontend variables.
- `WEB_ACCESS_PASSWORD` must be at least 24 characters. Check it locally before
  starting the API; never paste it into chat.
- The project declares Node.js `>=22.22.0`; the installed Node.js is `22.20.0`.
  This is below the declared support floor. SQLite uses Node's built-in
  `node:sqlite`, which is experimental on this installed runtime. The feature
  tests passed on it, but use a compatible runtime later if the experimental
  API changes; no runtime was installed.

## Start a laptop-only test

Before starting, if the local website access code is missing or too short,
generate one in a local PowerShell terminal:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Put the generated value in `voice-agent-web/.env` as `WEB_ACCESS_PASSWORD`.
Keep it private. Do not change or share the LiveKit API credentials.

Open separate PowerShell terminals in the project root
(`D:\n8n AI agnets\voice agent\livekit-voice-agent`):

1. **Python agent** — only if it is not already running:

   ```powershell
   uv run agent.py dev
   ```

2. **Token API:**

   ```powershell
   Set-Location .\voice-agent-web
   npm run dev:api
   ```

3. **Website:**

   ```powershell
   Set-Location .\voice-agent-web
   npm run dev
   ```

On the laptop, open `http://localhost:5173`. Enter the access code and allow
microphone access. The frontend uses LiveKit Cloud for the audio session; the
Python worker must be connected to the same LiveKit project. Successful page
loading or `/api/health` is not proof of a completed spoken conversation.

## Test personalization and history

1. Open **Settings** and unlock the private area with the access code.
2. Change the assistant name, personality, greeting, language, response style,
   and optional custom instructions. Save and confirm the saved message.
3. Return to **Voice**, enter the access code, and start a new conversation.
   The API snapshots the saved settings into the new room's metadata. The
   Python agent reads that metadata to build its actual instructions and speak
   the configured greeting. Saving settings does not change a conversation
   that is already running.
4. End the conversation, open **History**, and select the record. The app saves
   only final transcript events received from LiveKit; if none were published,
   it shows an honest empty transcript. It does not fabricate text or save
   microphone audio.
5. Delete one record or use **Clear all**. Both actions require browser
   confirmation.

Assistant settings, conversation metadata, and received transcript text persist
in `voice-agent-web/data/aural.sqlite` across API restarts. The database is
ignored by Git. History is partitioned by the signed HttpOnly browser owner
cookie; clearing cookies can make old records inaccessible from the UI. The
agent does not remember facts across conversations.

## Phone options

### Same Wi-Fi: page-only check

The laptop's current Wi-Fi address was `10.7.11.142`; it can change when
reconnecting. With the phone and laptop on the same trusted Wi-Fi, open
`http://10.7.11.142:5173`. Vite now listens on the laptop's network
interfaces. If Windows Firewall asks, allow Node.js only on the private
network.

This plain HTTP address can confirm that the page is reachable, but phone
browsers generally do not treat a LAN IP over HTTP as a secure context. This
website checks for HTTPS or localhost before requesting microphone access, so
do not expect a voice conversation to work at this address.

### Temporary HTTPS tunnel: real phone microphone test

A tunnel can give the laptop's local website a temporary HTTPS URL. It can
enable mobile microphone access, but it also temporarily exposes the local Vite
development server through a public URL. Anyone who obtains that URL may reach
the page; the access code still protects token creation, but it is not a
replacement for public-site authentication. Keep the tunnel private, do not
share the URL, expose only Vite port `5173` (not API port `3001`), and stop the
tunnel as soon as testing ends.

No tunnel executable was found on the current PATH. Do not install or download
one without first choosing a provider and approving that action. If you approve
a tunnel later, configure the API's `WEB_ORIGIN` to that exact HTTPS origin in
the API terminal's process environment (not in a `VITE_` variable); configure
`VITE_ALLOWED_HOST` to the URL's hostname before starting Vite. This allows
only the selected tunnel hostname rather than disabling Vite's host checks.
The tunnel should forward public HTTPS traffic to local port `5173`, where Vite
proxies `/api` to the API bound on `127.0.0.1:3001`.

## Further learning roadmap

1. **Voice settings:** explore the configured LiveKit Inference voices and
   supported settings, record a baseline, and change one setting at a time.
   Check model availability and usage costs before experimentation.
2. **History improvements:** consider export, search, retention limits, and
   explicit transcript consent before adding any more persistent data.
3. **Incoming calls:** learn SIP/PSTN concepts and LiveKit's SIP integration;
   map number/provider, inbound routing, room creation, agent dispatch, and
   disconnect handling. A phone number, provider configuration, and usage may
   cost money. Do not provision or route calls in this phase.
4. **Outgoing calls:** learn outbound trunk setup, destination allowlists,
   explicit user consent, caller identity requirements, abuse prevention, and
   local legal requirements. Use a sandbox or a call to your own number only
   after separately approving provider setup, charges, and the test call.

No telephone service is being configured and no call is being placed.
