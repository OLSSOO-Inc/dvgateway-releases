"""
Example 3: Mid-Level API — 세밀한 제어

파이프라인 빌더 대신 개별 스트림 API를 직접 사용합니다.
다음 시나리오에 적합:
  - 커스텀 VAD (음성 활동 감지) 구현
  - 인터럽션 감지 (사용자가 말하면 TTS 중단)
  - 멀티 턴 대화 히스토리 외부 관리
  - 상담원/고객 음성 분리 처리

Run:
  python examples/python/03_advanced_mid_level_api.py
"""

import asyncio
import os
import signal

from dotenv import load_dotenv

from dvgateway import DVGatewayClient, Message, detect_voice_activity
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter, GeminiTtsAdapter
from dvgateway.types import CallNewEvent, CallEndedEvent

load_dotenv()


# ─── 콜별 대화 상태 관리 ─────────────────────────────────────────────────

sessions: dict[str, dict] = {}


async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={"type": "apiKey", "api_key": os.environ.get("DV_API_KEY", "dev-no-auth")},
    )

    # ─── 콜 이벤트 구독 ──────────────────────────────────────────────────

    async def handle_event(event):
        # ── 새 콜 ────────────────────────────────────────────────────────
        if isinstance(event, CallNewEvent):
            session = event.session
            print(
                f"[{session.linked_id}] 새 콜: {session.caller}\n"
                f"   커스텀값1   : {session.custom_value_1 or '없음'}\n"
                f"   커스텀값2   : {session.custom_value_2 or '없음'}\n"
                f"   커스텀값3   : {session.custom_value_3 or '없음'}"
            )
            # ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
            # Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
            # 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터

            sessions[session.linked_id] = {
                "session": session,
                "history": [Message(role="system", content="당신은 친절한 AI 상담원입니다.")],
                "is_speaking": False,
            }

            # 고객 방향(in) 오디오만 구독
            audio_stream = gw.stream_audio(session.linked_id, dir="in")

            stt = DeepgramAdapter(
                api_key=os.environ["DEEPGRAM_API_KEY"],
                language="ko",
            )

            def on_transcript(result):
                if not result.is_final:
                    return
                asyncio.ensure_future(handle_final_transcript(session.linked_id, result))

            stt.on_transcript(on_transcript)

            # STT 스트림 시작
            asyncio.ensure_future(stt.start_stream(session.linked_id, audio_stream))

            # 세션 메타데이터 업데이트
            await gw.update_session_meta(session.linked_id, {
                "bot_type": "cs-agent",
                "language": "ko",
            })

        # ── 콜 종료 ──────────────────────────────────────────────────────
        elif isinstance(event, CallEndedEvent):
            sessions.pop(event.linked_id, None)
            print(f"[{event.linked_id}] 종료 ({event.duration_sec}초)")

            stats = gw.metrics.stt_latency.percentiles()
            print(f"STT 지연: p50={stats['p50']}ms, p95={stats['p95']}ms")

    async def handle_final_transcript(linked_id: str, result) -> None:
        state = sessions.get(linked_id)
        if not state:
            return

        print(f"[{linked_id}] \"{result.text}\"")

        state["history"].append(Message(role="user", content=result.text))

        llm = OpenAILlmAdapter(
            api_key=os.environ["OPENAI_API_KEY"],
            model="gpt-4o-mini",
        )

        response = ""
        async for token in llm.chat(state["history"]):
            response += token

        if not response:
            return
        state["history"].append(Message(role="assistant", content=response))
        print(f"[{linked_id}] AI: \"{response}\"")

        tts_provider = os.environ.get("TTS_PROVIDER", "gemini")
        if tts_provider == "elevenlabs":
            tts = ElevenLabsAdapter(
                api_key=os.environ["ELEVENLABS_API_KEY"],
                model="eleven_flash_v2_5",
            )
        else:
            tts = GeminiTtsAdapter(
                api_key=os.environ["GEMINI_API_KEY"],
            )

        state["is_speaking"] = True
        try:
            await gw.inject_tts(linked_id, tts.synthesize(response))
        finally:
            state["is_speaking"] = False

    gw.on_call_event(handle_event)

    print("Mid-level API 음성 봇 시작 (상담원 방향 분리 모드)")
    print("콜을 기다리는 중...")

    # Keep alive
    stop_event = asyncio.Event()

    def shutdown():
        gw.close()
        stop_event.set()

    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGTERM, shutdown)

    await stop_event.wait()


if __name__ == "__main__":
    asyncio.run(main())
