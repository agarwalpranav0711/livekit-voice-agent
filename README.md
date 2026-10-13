# LiveKit Voice Agent

A Python voice assistant built with LiveKit Agents. It listens to room audio,
transcribes speech, generates a short technology/programming-focused response,
and speaks it back.

## Features

- LiveKit Agents session with Silero voice activity detection.
- Speech-to-text fallback: AssemblyAI, then Deepgram.
- Language-model fallback: OpenAI GPT-4.1 mini, then Google Gemini 2.5 Flash.
- Text-to-speech fallback: Cartesia Sonic 3, then Inworld TTS.
- Background-noise cancellation and usage/latency logging.

These providers are configured through LiveKit Inference in `agent.py`. Check
your LiveKit project’s enabled models, account requirements, and usage pricing
before running the agent.

## Requirements

- Python 3.13 or newer.
- [uv](https://docs.astral.sh/uv/) for dependency and virtual-environment
  management.
- The LiveKit CLI (`lk`) for the recommended development command.
- A LiveKit project with its URL, API key, and API secret.

## Setup

1. Clone the repository and open the project directory:

   ```powershell
   git clone <repository-url>
   cd livekit-voice-agent
   ```

2. Install `uv` using its [official installation
   instructions](https://docs.astral.sh/uv/getting-started/installation/).

3. Install the LiveKit CLI on Windows:

   ```powershell
   winget install LiveKit.LiveKitCLI
   ```

   Open a new terminal after installation so `lk` is available on `PATH`.

4. Create your local environment file if you do not already have one:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Edit `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
   `LIVEKIT_API_SECRET` from your LiveKit project settings. Do not commit this
   file or share its values.

6. Install the locked dependencies:

   ```powershell
   uv sync --locked
   ```

## Run locally

From the project directory, start the LiveKit Agents development worker:

```powershell
lk agent dev
```

The worker connects to your LiveKit project and waits for a job. It needs a
LiveKit room/session to receive audio; connect to it using a LiveKit client or
your existing LiveKit application. The `lk` command is the current recommended
development workflow.

With LiveKit Agents 1.8.6, the Python CLI fallback is also available:

```powershell
uv run agent.py dev
```

The fallback works but prints a deprecation notice recommending `lk agent dev`.

## Website voice assistant

The React/TypeScript browser client and its short-lived token API are in
[`voice-agent-web/`](./voice-agent-web/README.md). The API reuses the LiveKit
credentials in this project's ignored `.env`; the browser never receives the
API key or secret.

The existing Python worker uses an unnamed `@server.rtc_session()` entry point.
LiveKit automatically dispatches an unnamed worker when a new room is created,
so the web client creates a unique room per conversation and connects to it.
The API intentionally does not request a named agent dispatch, which would not
target this worker. Keep the worker running while testing the website.

Follow the web README for private access-code setup and the commands to run the
agent, token API, and website in separate terminals. Automated local checks do
not prove a live conversation; that additionally requires valid LiveKit Cloud
credentials, an active agent worker, a microphone-enabled browser, and
successful audio from your configured providers.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit server or Cloud project URL |
| `LIVEKIT_API_KEY` | LiveKit project API key |
| `LIVEKIT_API_SECRET` | LiveKit project API secret |

The agent uses LiveKit Inference for the configured speech, language, and
turn-detection models. Its LiveKit turn detector automatically selects the
available model for the environment and can fall back to a local model. Audio
and related inference data may be processed by LiveKit and the configured
model providers. Review their current privacy, retention, and billing terms
before using real or sensitive conversations.

## Repository hygiene

- `.env` and other local environment files are ignored by Git. `.env.example`
  contains empty values only and is safe to commit.
- The local `.venv`, caches, logs, and build artifacts are ignored.
- Keep `uv.lock` committed so installs can be reproduced with `uv sync --locked`.
- If a credential has ever been committed or shared, revoke/rotate it; removing
  it from the latest commit alone does not remove it from Git history.

## License

No license has been added. Unless a license is chosen, others generally do not
have permission to reuse, modify, or distribute this project.
