# Deferred: online deployment guide

> **Not the current project plan.** The project is for local development only.
> Do not create hosting resources, deploy, or purchase services as part of the
> current work. Use [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for the
> active plan and phone-testing options. The material below is retained only
> as an unexecuted reference for a possible future decision.

This guide prepares the existing voice assistant for remote use. It does not
create cloud resources, deploy services, or require this Windows computer to
remain on after deployment.

## Recommended architecture

Deploy two cloud services:

1. **Python voice agent — LiveKit Cloud.** The existing `agent.py` uses
   LiveKit Agents and LiveKit Inference. LiveKit Cloud supplies the worker's
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` at runtime.
2. **Website and token API — one Render web service.** The Vite build is served
   by the existing Express API, so the browser and `/api/token` share one
   HTTPS origin. Render terminates public HTTPS and routes requests to the
   Express process.

This keeps API signing credentials server-side and avoids separate frontend
and API CORS origins. The API uses an in-memory rate limiter, so run one web
service instance unless it is changed to use a shared rate-limit store.

## What is already prepared

- The repository did not contain `livekit.toml`, a LiveKit agent Dockerfile,
  or another deployment definition. The root `Dockerfile` now follows LiveKit's
  Python/uv deployment pattern and the project-locked Python 3.13 dependencies.
- The website container builds the React application and serves it and the API
  from one process. Production binds to `0.0.0.0` and honors the hosting
  platform's `PORT`.
- The API sets a Content Security Policy that permits connections only to the
  configured LiveKit host, allows microphone access on the website origin, and
  retains the exact-origin access-code and short-lived token controls.
- Docker build contexts exclude environment files, caches, local virtual
  environments, and the other service's files.

No cloud project, agent, website service, domain, or paid plan has been
created. The local Windows/D-drive files and caches are not transferred to the
cloud. No D-drive cache configuration was found in the agent source or
environment-variable names inspected; the local cache remains untouched. Model
files needed by a cloud worker are downloaded into its runtime/container as
required.

## Before deploying

You need:

- Access to the GitHub repository and a LiveKit Cloud project.
- A current LiveKit CLI (`lk`) installed locally.
- A Render account connected to the GitHub repository.
- A production access code generated locally. Do not reuse or publish the
  development code.
- The exact public HTTPS origin Render assigns to the web service.

Review the LiveKit Cloud and Render plan/pricing pages before creating a
service. LiveKit Cloud's free Build plan may scale the agent to zero and add
roughly 10–20 seconds of cold-start time. Free web hosting can sleep or have
other limitations. A paid always-on plan may be needed for consistently quick
phone access. LiveKit Inference or other configured voice services can also
incur usage charges.

## Deploy the Python agent to LiveKit Cloud

1. Open the LiveKit Cloud dashboard and inspect **Agents** for an existing
   deployment of this project before creating anything.
2. If an existing deployment is present, do not create a duplicate. Follow
   LiveKit's deployment-management instructions to link its existing agent ID
   and project configuration to this checkout.
3. If no deployment exists, install/update the official LiveKit CLI and
   authenticate:

   ```powershell
   lk cloud auth
   lk project list
   lk project set-default "<the exact project name shown by lk project list>"
   ```

4. From the repository root, create the agent **only after verifying the
   selected LiveKit project**:

   ```powershell
   Set-Location "D:\n8n AI agnets\voice agent\livekit-voice-agent"
   lk agent create
   ```

   This is the first cloud-resource/build/deployment action: LiveKit documents
   that it creates an agent ID, writes `livekit.toml`, builds the container,
   and deploys it. It may incur usage charges. The prepared Dockerfile starts
   the existing agent with `agent.py start`; it does not replace agent code or
   provider fallbacks. Do not supply the root `.env` as an agent secrets file:
   LiveKit Cloud provides its own LiveKit connection credentials.
5. Inspect deployment status and logs:

   ```powershell
   lk agent status
   lk agent logs
   ```

The existing agent has an unnamed `@server.rtc_session()` entry point. The
website creates a new room and relies on LiveKit's automatic dispatch for
unnamed agents. Confirm in the deployed agent logs/dashboard that it receives
the website-created room. Do not add named dispatch unless the worker is
deliberately migrated to a matching named agent.

The root `.dockerignore` protects `.env`, `.env.*`, local environments,
generated caches, and the website from the agent build context. The LiveKit
CLI also excludes environment files and Git/Docker-ignored files when
preparing its build context. Verify the build output contains no local secrets.

## Deploy the website and API to Render

1. In the Render dashboard, choose **New → Web Service**, connect the GitHub
   repository, and select the branch containing this deployment preparation.
   Do not deploy until these local changes have been reviewed and pushed by
   you.
2. Configure the service:

   | Setting | Value |
   | --- | --- |
   | Root Directory | `voice-agent-web` |
   | Runtime | Docker |
   | Dockerfile Path | `Dockerfile` |
   | Docker Build Context Directory | `.` |
   | Health Check Path | `/api/health` |

3. Choose the plan you intend to pay for. A free plan can sleep; do not assume
   it provides always-on, low-latency service.
4. Choose the service name first. Its Render URL is normally
   `https://<service-name>.onrender.com`. Set the following environment
   variables in Render's Environment settings. Type secret values directly
   into Render; never place them in the repository, build arguments, Docker
   files, or chat.

   | Variable | Value |
   | --- | --- |
   | `LIVEKIT_URL` | Your LiveKit Cloud project's secure `wss://...` URL |
   | `LIVEKIT_API_KEY` | A LiveKit API key reserved for backend token signing |
   | `LIVEKIT_API_SECRET` | The secret paired with that backend key |
   | `WEB_ACCESS_PASSWORD` | A newly generated, random value at least 24 characters long |
   | `WEB_ORIGIN` | Exact assigned public origin, e.g. `https://<service-name>.onrender.com` |
   | `TRUST_PROXY_HOPS` | `1` for Render's proxy |

   Do not set `VITE_LIVEKIT_API_SECRET` or expose any LiveKit credential as a
   `VITE_` variable. The API key/secret on Render are used only by the server
   to sign a 10-minute, one-room participant token. They are distinct from
   LiveKit Cloud's runtime-injected agent credentials where possible.
5. Create the Render service. If the assigned URL differs from the value used
   for `WEB_ORIGIN`, correct `WEB_ORIGIN` to the exact `https://` origin in the
   Render dashboard and redeploy.
6. Verify `https://<service-name>.onrender.com/api/health` returns
   `{"status":"ok"}`. Open the HTTPS site and check browser developer tools
   show no CSP, CORS, or mixed-content errors.

Keep this shared access-code website private. A shared code is not a full
user-account system; do not publish the code or treat it as suitable for a
public, multi-user product. Keep a single web-service instance while rate
limiting is in memory. If that changes, configure a shared rate-limit store
before adding replicas.

## Secrets, costs, and local cache

- GitHub stores only `.env.example` placeholders. LiveKit keys and the access
  code belong in hosting-provider secret settings.
- Create a dedicated LiveKit API key for the token API and apply the minimum
  room permissions supported by your LiveKit Cloud project. Keep the key's
  secret private and rotate it if exposed.
- LiveKit Cloud injects the agent's LiveKit credentials; use LiveKit Cloud's
  encrypted agent secrets feature only for any additional provider secrets
  the code actually needs.
- This code uses LiveKit Inference model identifiers and currently does not
  read direct OpenAI, Gemini, AssemblyAI, Deepgram, Cartesia, or Inworld keys.
  Do not add those credentials unless the agent implementation is intentionally
  changed to require them.
- The local D-drive cache cannot be mounted into LiveKit Cloud. This project
  does not define a D-drive path in its Python source or environment variables.
  Docker ignores local cache/model directories; the cloud worker uses its own
  container filesystem and any models it downloads there.

## Final phone test after deployment

1. Confirm the Render site opens at its `https://` URL and `/api/health` returns
   `{"status":"ok"}`.
2. Confirm the agent deployment is healthy in LiveKit Cloud; inspect logs for
   a worker registered to the same project.
3. On your phone, open the HTTPS website, enter the private access code, tap
   **Start talking**, and allow microphone permission.
4. Wait for **Assistant ready**, say a short test sentence, and confirm you
   hear an actual spoken response. A successful health check or room connection
   alone does not verify a conversation.

## Official references

- [LiveKit agent deployment quickstart](https://docs.livekit.io/deploy/agents/quickstart/)
- [LiveKit builds and Dockerfiles](https://docs.livekit.io/deploy/agents/builds/)
- [LiveKit deployment management](https://docs.livekit.io/deploy/agents/managing-deployments/)
- [LiveKit agent secrets](https://docs.livekit.io/deploy/agents/secrets/)
- [Render Docker web services](https://render.com/docs/docker)
- [Render web services, ports, and HTTPS](https://render.com/docs/web-services)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
