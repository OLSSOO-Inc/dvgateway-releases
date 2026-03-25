# bot_enhanced.py — 키워드 부스팅 + 감정 분석 + 발신자 정보 + TTS 인사 재생
#
# examples/python/04_enhanced_voice_bot.py 를 기반으로
# 사용자가 프로젝트 루트에서 바로 복사·실행할 수 있도록 만든 독립 파일입니다.
#
# 사용법:
#   1) cp .env.example .env  # API 키 채우기
#   2) pip install dvgateway python-dotenv
#   3) python bot_enhanced.py
#
# 필수 환경변수 (.env):
#   DV_API_KEY, DEEPGRAM_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()

SENTIMENT_EMOJI = {
    "positive": "😊",
    "neutral": "😐",
    "negative": "😠",
}


async def main() -> None:
    # ── 0. API 키 확인 ──────────────────────────────────────────
    required_keys = ["DV_API_KEY", "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"]
    missing = [k for k in required_keys if not os.environ.get(k)]
    if missing:
        print(f"❌ .env 파일에 다음 키가 없습니다: {', '.join(missing)}")
        print("   .env 파일을 확인하고 API 키를 넣어주세요.")
        return

    # ── 1. 게이트웨이 서버 연결 ──────────────────────────────────
    #    ⚠️ 로컬 개발 시 security={"force_tls": False} 필수!
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={
            "type": "apiKey",
            "api_key": os.environ["DV_API_KEY"],
        },
        security={"force_tls": False},
    )

    # ── 2. STT: 도메인 키워드 부스팅 + 감정 분석 ─────────────────
    #    keywords 리스트에 내 서비스의 전문 용어를 넣으세요.
    #    ⚠️ keywords는 기본 적용이 아닙니다 — 직접 설정해야 합니다!
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        interim_results=True,
        endpointing_ms=400,
        smart_format=True,
        keywords=[                        # ← 도메인 용어 부스팅
            "게이트웨이", "DVGateway",     #   제품명
            "OLSSOO", "올쏘",             #   회사명
            "SIP", "RTP", "WebRTC",       #   기술 용어
            "인바운드", "아웃바운드",        #   업무 용어
        ],
        sentiment=True,                   # ← 감정 분석 활성화
    )

    # ── 3. LLM ───────────────────────────────────────────────────
    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt="당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    # ── 4. TTS ───────────────────────────────────────────────────
    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id=os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
    )

    # ── 5. 이벤트 핸들러 ─────────────────────────────────────────

    async def on_new_call(session):
        """전화가 오면 발신자 정보 출력 + TTS 인사말 재생."""
        print(
            f"📞 전화가 왔어요!\n"
            f"   linked_id : {session.linked_id}\n"
            f"   발신자번호 : {session.caller or '알 수 없음'}\n"
            f"   발신자이름 : {session.caller_name or '알 수 없음'}\n"
            f"   DID 번호   : {session.did or '알 수 없음'}\n"
            # ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
            # Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
            # 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
            f"   커스텀값1   : {session.custom_value_1 or '없음'}\n"
            f"   커스텀값2   : {session.custom_value_2 or '없음'}\n"
            f"   커스텀값3   : {session.custom_value_3 or '없음'}"
            # ── session에서 추가로 출력할 수 있는 필드 ──
            # f"\n   착신번호   : {session.callee}"        # 착신번호 (B-leg / EXTEN)
            # f"\n   콜 ID     : {session.call_id}"        # 업무 시스템 통화 ID (CRM 등)
            # f"\n   상담원내선 : {session.agent_number}"   # 상담원 내선번호
            # f"\n   방향       : {session.dir}"            # 스트림 방향 (both/in/out)
            # f"\n   컨퍼런스ID : {session.conf_id}"        # ConfBridge 컨퍼런스 ID
            # f"\n   테넌트 ID  : {session.tenant_id}"      # 멀티테넌트 식별자
            # f"\n   시작시각   : {session.started_at}"     # 통화 시작 시각 (datetime)
            # f"\n   스트림 URL : {session.stream_url}"     # 오디오 WebSocket URL
            # f"\n   메타데이터 : {session.metadata}"       # 커스텀 키-값 메타데이터
        )

        # TTS로 환영 인사를 먼저 재생합니다
        await gw.say(
            session.linked_id,
            "안녕하세요, OLSSOO AI 안내 서비스입니다. 무엇을 도와드릴까요?",
            tts,
        )
        print("🔊 인사말 재생 완료")

    def on_transcript(result, session):
        """감정 분석 결과를 포함한 STT 출력."""
        if not result.is_final:
            return

        sentiment_str = ""
        if result.sentiment:
            emoji = SENTIMENT_EMOJI.get(result.sentiment.sentiment, "")
            score_pct = round(result.sentiment.sentiment_score * 100)
            sentiment_str = f" {emoji} {result.sentiment.sentiment}({score_pct}%)"

        confidence_pct = round((result.confidence or 0) * 100)
        print(
            f"🎙️  고객: {result.text}"
            f"  [신뢰도:{confidence_pct}%{sentiment_str}]"
        )

    def on_call_ended(linked_id, duration):
        print(f"📴 통화 종료. 통화 시간: {duration}초")

    def on_error(err, linked_id=None):
        print(f"❌ [{linked_id or 'global'}] 오류: {err}")

    # ── 6. 파이프라인 시작 ───────────────────────────────────────

    print("확장 봇을 시작합니다...")
    print(f"게이트웨이: {os.environ.get('DV_BASE_URL', 'http://localhost:8080')}")
    print("콜을 기다리는 중...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(on_new_call)
        .on_transcript(on_transcript)
        .on_call_ended(on_call_ended)
        .on_error(on_error)
        .start()
    )


if __name__ == "__main__":
    asyncio.run(main())
