
import logging
import time

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    room_io,
    llm,
    stt,
    tts,
    inference,
    AgentStateChangedEvent,
    MetricsCollectedEvent,
    metrics,
)
from livekit.plugins import noise_cancellation, silero
from assistant_settings import build_instructions, parse_room_settings

load_dotenv()

logger = logging.getLogger(__name__)


# Assistant personality
class Assistant(Agent):
    def __init__(self, instructions: str) -> None:
        super().__init__(instructions=instructions)


# LiveKit agent server
server = AgentServer()


# Main voice agent entry point
@server.rtc_session()
async def entrypoint(ctx: JobContext):
    settings = parse_room_settings(ctx.room.metadata)

    # Load VAD once
    vad = silero.VAD.load()

    # LLM fallback: OpenAI -> Gemini
    llm_fallback = llm.FallbackAdapter(
        [
            inference.LLM(model="openai/gpt-4.1-mini"),
            inference.LLM(model="google/gemini-2.5-flash"),
        ]
    )

    # STT fallback: AssemblyAI -> Deepgram
    stt_fallback = stt.FallbackAdapter(
        [
            inference.STT.from_model_string(
                "assemblyai/universal-streaming:en"
            ),
            inference.STT.from_model_string(
                "deepgram/nova-3"
            ),
        ]
    )

    # TTS fallback: Cartesia -> Inworld
    tts_fallback = tts.FallbackAdapter(
        [
            inference.TTS.from_model_string(
                "cartesia/sonic-3:"
                "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
            ),
            inference.TTS.from_model_string(
                "inworld/inworld-tts-1"
            ),
        ]
    )

    # Configure voice pipeline and latency optimization
    session = AgentSession(
        stt=stt_fallback,
        llm=llm_fallback,
        tts=tts_fallback,
        vad=vad,
        turn_handling={"turn_detection": inference.TurnDetector()},
    )

    # Collect usage metrics
    usage_collector = metrics.UsageCollector()

    # Track the latest end-of-utterance metrics
    last_eou_metrics: metrics.EOUMetrics | None = None

    @session.on("metrics_collected")
    def on_metrics_collected(ev: MetricsCollectedEvent):
        nonlocal last_eou_metrics

        if ev.metrics.type == "eou_metrics":
            last_eou_metrics = ev.metrics

        metrics.log_metrics(ev.metrics)
        usage_collector.collect(ev.metrics)

    # Measure time to first audio
    @session.on("agent_state_changed")
    def on_agent_state_changed(ev: AgentStateChangedEvent):
        if ev.new_state == "speaking" and last_eou_metrics:
            elapsed = time.time() - last_eou_metrics.timestamp

            logger.info(
                "Time to first audio: %.3fs",
                elapsed,
            )

    # Print usage summary at shutdown
    async def log_usage():
        summary = usage_collector.get_summary()
        logger.info("Usage summary: %s", summary)

    ctx.add_shutdown_callback(log_usage)

    # Start session with noise cancellation
    await session.start(
        agent=Assistant(build_instructions(settings)),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=noise_cancellation.BVC(),
            ),
        ),
    )
    session.say(settings.greeting)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agents.cli.run_app(server)
