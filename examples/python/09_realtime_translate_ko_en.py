"""
Example: Real-time Korean ↔ English interpreter (gpt-realtime-translate).

The caller speaks Korean, and the AI re-speaks it in English on the call
leg in real time. Swap ``input_language`` / ``output_language`` to invert
the direction or pick another supported pair (Realtime translate supports
70+ input languages → 13 output languages).

No STT / LLM / TTS adapters are wired — the translate model takes audio
in and emits translated audio out in a single WebSocket session.

Run:
    cp .env.example .env  # set OPENAI_API_KEY + DV_BASE_URL + DV_API_KEY
    python examples/python/09_realtime_translate_ko_en.py
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import (
    OpenAIRealtimeAdapter,
    OpenAIRealtimeTurnDetectionOptions,
)

load_dotenv()


async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.getenv("DV_BASE_URL", "http://localhost:8080"),
        auth={"type": "apiKey", "api_key": os.getenv("DV_API_KEY", "dev-no-auth")},
    )

    # `input_language` + `output_language` + `gpt-realtime-translate` is
    # enough. The SDK synthesizes the recommended translation system
    # prompt (faithful, no commentary, preserves names/numbers, keeps
    # pace). To override, pass `instructions="..."` — yours always wins.
    interpreter = OpenAIRealtimeAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-realtime-translate",
        voice="alloy",
        input_language="ko",   # caller speaks Korean
        output_language="en",  # AI re-speaks in English
        turn_detection=OpenAIRealtimeTurnDetectionOptions(
            mode="server_vad",
            threshold=0.5,
            prefix_padding_ms=300,
            silence_duration_ms=500,
        ),
    )

    def on_transcript(t):  # type: ignore[no-untyped-def]
        # speaker: "customer" = caller (Korean), "agent" = AI (English)
        tag = "EN" if t.speaker == "agent" else "KO"
        print(f"[{tag}] {t.text}")

    def on_error(err, linked_id):  # type: ignore[no-untyped-def]
        print(f"[interpreter] error linked_id={linked_id or 'n/a'}: {err}")

    interpreter.on_transcript(on_transcript)
    interpreter.on_error(on_error)

    print("🎙️  Korean → English live interpreter ready")
    print(f"📡  Gateway: {os.getenv('DV_BASE_URL')}")
    print("🌐  Translate: ko → en (swap input_language/output_language to invert)\n")

    # Route the AI's translated audio back into the call. The adapter passes
    # the linked_id of the session that produced the audio, so one handler
    # serves every call. inject_tts takes an async iterable of PCM chunks.
    def on_audio(chunk: bytes, linked_id: str) -> None:
        async def once():  # type: ignore[no-untyped-def]
            yield chunk

        asyncio.ensure_future(gw.inject_tts(linked_id, once()))

    interpreter.on_audio_output(on_audio)

    # Events are objects (event.type / event.session.linked_id), not dicts.
    async def on_call(event):  # type: ignore[no-untyped-def]
        if event.type == "call:new":
            linked_id = event.session.linked_id
            print(f"[call {linked_id}] connected — starting interpreter session")
            audio_stream = gw.stream_audio(
                linked_id,
                dir="in",            # capture caller audio only
                pipeline_type="s2s",
            )
            await interpreter.start_session(linked_id, audio_stream)
        elif event.type == "call:ended":
            await interpreter.stop(event.linked_id)
            print(f"[call {event.linked_id}] interpreter session ended")

    # The SDK opens the call-event socket on the first subscription (no connect()).
    gw.on_call_event(on_call)
    try:
        await asyncio.Event().wait()   # run until Ctrl+C
    finally:
        print("\nShutting down interpreter…")
        await interpreter.stop()       # no argument = stop every session
        gw.close()


if __name__ == "__main__":
    asyncio.run(main())
