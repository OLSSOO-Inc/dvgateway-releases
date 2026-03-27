"""
Example 1: Basic AI Voice Bot (Korean)

Answers incoming calls with an OpenAI GPT-powered AI assistant.
STT: Deepgram Nova-3 (Korean)
LLM: OpenAI GPT-4o-mini (streaming)
TTS: ElevenLabs Flash v2.5 (Korean voice)

Target E2E latency: < 500ms

DVGateway ports:
  :8080 — API server (this SDK connects here)
  :8092 — Media server (Dynamic VoIP connects here, GW_MEDIA_ADDR)
  :8088 — Dynamic VoIP ARI (DVGateway connects to Dynamic VoIP here)

Prerequisites:
  pip install dvgateway-python python-dotenv

Environment variables (set in .env or export):
  DV_BASE_URL=http://<gateway-host>:8080
  DV_API_KEY=dvgw_xxxx...   # SDK API key from dashboard
  DEEPGRAM_API_KEY=...
  OPENAI_API_KEY=...
  ELEVENLABS_API_KEY=...

Run:
  cp .env.example .env  # fill in your API keys
  python examples/python/01_basic_voice_bot.py
"""

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter, GeminiTtsAdapter

load_dotenv()


async def main() -> None:
    # ─── 1. 클라이언트 초기화 ────────────────────────────────────────────

    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={
            "type": "apiKey",
            "api_key": os.environ.get("DV_API_KEY", "dev-no-auth"),
        },
        reconnect={
            "max_attempts": 10,
            "initial_delay_ms": 2000,
            "on_reconnect": lambda attempt: print(f"[reconnect] 재연결 시도 #{attempt}"),
        },
    )

    # ─── 2. AI 어댑터 설정 ───────────────────────────────────────────────

    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        interim_results=True,
        endpointing_ms=400,
        smart_format=True,
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt=(
            "당신은 OLSSOO Inc.의 친절한 AI 고객 상담원입니다. "
            "답변은 TTS에 적합하게 짧고 자연스러운 구어체로 해주세요. "
            "한 번에 1-2문장 이내로 답하세요."
        ),
        max_tokens=256,
        temperature=0.7,
    )

    tts_provider = os.environ.get("TTS_PROVIDER", "gemini")

    if tts_provider == "elevenlabs":
        tts = ElevenLabsAdapter(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            voice_id=os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
            model="eleven_flash_v2_5",
        )
    else:
        tts = GeminiTtsAdapter(
            api_key=os.environ["GEMINI_API_KEY"],
        )

    # ─── 3. 파이프라인 시작 ──────────────────────────────────────────────

    print("DVGateway AI 음성 봇 시작...")
    print(f"게이트웨이: {os.environ.get('DV_BASE_URL', 'http://localhost:8080')}")
    print("콜을 기다리는 중...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(lambda session: print(
            f"📞 새 콜 수신\n"
            f"   linked_id : {session.linked_id}\n"
            f"   발신자번호 : {session.caller or '알 수 없음'}\n"
            f"   발신자이름 : {session.caller_name or '알 수 없음'}\n"
            f"   DID 번호   : {session.did or '알 수 없음'}\n"
            # ── session에서 추가로 출력할 수 있는 필드 ──
            # f"   착신번호   : {session.callee}"        # 착신번호 (B-leg / EXTEN)
            # f"   콜 ID     : {session.call_id}"        # 업무 시스템 통화 ID (CRM 등)
            # f"   상담원내선 : {session.agent_number}"   # 상담원 내선번호
            # f"   방향       : {session.dir}"            # 스트림 방향 (both/in/out)
            # f"   컨퍼런스ID : {session.conf_id}"        # ConfBridge 컨퍼런스 ID
            # f"   테넌트 ID  : {session.tenant_id}"      # 멀티테넌트 식별자
            # f"   시작시각   : {session.started_at}"     # 통화 시작 시각 (datetime)
            # f"   스트림 URL : {session.stream_url}"     # 오디오 WebSocket URL
            # f"   메타데이터 : {session.metadata}"       # 커스텀 키-값 메타데이터
            # ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
            # Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
            # 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
            f"   커스텀값1   : {session.custom_value_1 or '없음'}\n"
            f"   커스텀값2   : {session.custom_value_2 or '없음'}\n"
            f"   커스텀값3   : {session.custom_value_3 or '없음'}"
        ))
        .on_call_ended(lambda linked_id, duration: (
            print(f"[{linked_id}] 통화 종료 ({duration}초)"),
            gw.metrics.log_summary(),
        ))
        .on_transcript(lambda result, session: (
            print(f"[{session.linked_id}] 사용자: \"{result.text}\" "
                  f"(신뢰도: {round((result.confidence or 0) * 100)}%)")
            if result.is_final else None
        ))
        .on_error(lambda err, linked_id=None: print(f"[{linked_id or 'global'}] 오류: {err}"))
        .start()
    )


if __name__ == "__main__":
    asyncio.run(main())
