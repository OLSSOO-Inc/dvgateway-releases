"""
Example 10: GPT-Live voice agent (OpenAI gpt-live-1, full duplex).

The caller talks to OpenAI GPT-Live through the gateway. GPT-Live listens
while it speaks and hands "thinking" work to your backend (delegation).

Before you run it:
  1. Dialplan: route the number to ``Stasis(dvgateway, mode=customer)`` —
     GPT-Live must hear ONLY the caller. With mode=both the stream also
     carries the AI's own voice and the model answers itself.
  2. OPENAI_API_KEY must be a paid-tier key (GPT-Live has no free tier).
     Cost: $0.05 per connected minute (silence included) — always stop().

Run:
    cp .env.example .env  # set OPENAI_API_KEY + DV_BASE_URL + DV_API_KEY
    python examples/python/10_gpt_live_voice_agent.py
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import (
    GptLiveAdapter,
    SpeechSegmentInjector,
    build_gpt_live_instructions,
)
from dvgateway.adapters.tts import CachedTtsAdapter, OpenAITtsAdapter

load_dotenv()

NOTICE = "AI 상담원이 응대합니다."


async def check_availability(transcript: list[dict[str, str]], pending: str) -> str:
    """Your backend. Replace this stub with your real reservation lookup."""
    last_caller = next((t["text"] for t in reversed(transcript) if t["speaker"] == "customer"), pending)
    print(f"[backend] request: {last_caller}")
    return "확인해 보니 그 시간에 상담 예약이 가능합니다. 예약을 진행할지 물어봐 주세요."


async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.getenv("DV_BASE_URL", "http://localhost:8080"),
        auth={"type": "apiKey", "api_key": os.getenv("DV_API_KEY", "dev-no-auth")},
    )

    # AI notice (Korean AI Basic Act): a fixed sentence played BEFORE the GPT-Live
    # session — GPT-Live paraphrases, so it cannot guarantee exact wording.
    # Cached: the same sentence is synthesized once, not on every call.
    notice_tts = CachedTtsAdapter(
        OpenAITtsAdapter(api_key=os.environ["OPENAI_API_KEY"], voice="nova"),
        provider="openai",
    )

    live = GptLiveAdapter(
        os.environ["OPENAI_API_KEY"],
        {"type": "client"},  # your code answers delegations (on_delegation)
        # The delegation policy is required in practice: without it GPT-Live said
        # "yes, available" without checking in 2 of 5 measured runs (0 of 15 with it).
        instructions=build_gpt_live_instructions(
            persona="당신은 상담 예약을 돕는 한국어 전화 상담원입니다. 차분하고 친절하게 말합니다.",
            capabilities=["예약: 원하는 날짜·시간에 상담이 가능한지 확인하고, 예약을 만들거나 바꾸거나 취소합니다."],
        ),
    )

    # Inject GPT-Live audio one utterance at a time (not one chunk at a time —
    # every inject_tts call gets its own fade-in/fade-out on the gateway).
    out = SpeechSegmentInjector(
        lambda lid, chunks: gw.inject_tts(lid, chunks),
        on_error=lambda err, lid: print(f"[call {lid}] inject failed: {err}"),
    )
    live.on_audio_output(lambda pcm, lid: out.push(lid, pcm))

    live.on_transcript(lambda t: print(f"[{'AI' if t.speaker == 'agent' else 'caller'}] {t.text}"))

    async def on_delegation(d):  # type: ignore[no-untyped-def]
        return {"speak": await check_availability(d.transcript, d.pending)}

    live.on_delegation(on_delegation)

    def on_unspoken(u):  # type: ignore[no-untyped-def]
        # The result was sent but the model did not start speaking (measured 1 of 15).
        live.append_commentary(u.linked_id, u.delegation_id, "확인 결과를 지금 알려 주세요.")

    live.on_unspoken_result(on_unspoken)

    def on_usage(u):  # type: ignore[no-untyped-def]
        if u.confirmed:
            print(f"[call {u.linked_id}] GPT-Live billed {u.seconds}s")

    live.on_usage(on_usage)
    live.on_error(lambda err, lid: print(f"[call {lid or 'n/a'}] GPT-Live: {err}"))

    sessions: set[asyncio.Task[None]] = set()

    async def on_call(event):  # type: ignore[no-untyped-def]
        if event.type == "call:new":
            linked_id = event.session.linked_id
            # 1) Fixed notice first (not billed by GPT-Live — the session is not open yet).
            await gw.say(linked_id, NOTICE, notice_tts)
            # 2) Caller voice only — dir "in" with Stasis mode=customer.
            audio = gw.stream_audio(linked_id, dir="in", pipeline_type="s2s")
            # Do not await: the session lasts the whole call and this handler must
            # stay free to receive call:ended.
            task = asyncio.ensure_future(live.start_session(linked_id, audio))
            sessions.add(task)
            task.add_done_callback(sessions.discard)
        elif event.type == "call:ended":
            out.end(event.linked_id)
            await live.stop(event.linked_id)  # GPT-Live bills until the session closes

    # The SDK opens the call-event socket on the first subscription (no connect()).
    gw.on_call_event(on_call)
    print(f"🎙️  GPT-Live voice agent ready — gateway: {os.getenv('DV_BASE_URL')}")
    try:
        await asyncio.Event().wait()  # run until Ctrl+C
    finally:
        out.end_all()
        await live.stop()  # every session
        gw.close()


if __name__ == "__main__":
    asyncio.run(main())
