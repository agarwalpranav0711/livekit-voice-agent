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
- A LiveKit project with its URL, API key, and API secret.

## Setup

1. Clone the repository and open the project directory:

   ```powershell
   git clone <repository-url>
   cd livekit-voice-agent
   ```

2. Install `uv` using its [official installation
   instructions](https://docs.astral.sh/uv/getting-started/installation/).

3. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
   `LIVEKIT_API_SECRET` from your LiveKit project settings. Do not commit this
   file or share its values.

5. Install the locked dependencies:

   ```powershell
   uv sync --locked
   ```

## Run locally

Start the LiveKit Agents development worker:

```powershell
uv run agent.py dev
```

The agent runs as a worker and needs a LiveKit room/session to receive audio.
Connect to it using a LiveKit client or your existing LiveKit application.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit server or Cloud project URL |
| `LIVEKIT_API_KEY` | LiveKit project API key |
| `LIVEKIT_API_SECRET` | LiveKit project API secret |

The agent uses LiveKit Inference for the configured speech and language models.
Audio and related inference data may be processed by LiveKit and the configured
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
