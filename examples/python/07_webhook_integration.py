"""
Example 7: Webhook 어댑터 — n8n / Flowise / 사내 API 연동

LLM 호출을 외부 Webhook 엔드포인트로 위임합니다.
n8n 같은 노코드 도구에서 AI 응답 로직을 변경할 수 있습니다.

Webhook 요청/응답 형식:
  → POST {"messages": [...], "model": null, "maxTokens": null}
  ← {"text": "응답 텍스트"}  (또는 plain text)

STT: Deepgram Nova-3
LLM: WebhookAdapter → n8n (fallback: Claude Haiku)
TTS: ElevenLabs Flash v2.5

Run:
  cp .env.example .env
  python examples/python/07_webhook_integration.py
"""

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter, WebhookAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()


async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={"type": "apiKey", "api_key": os.environ.get("DV_API_KEY", "dev-no-auth")},
    )

    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        endpointing_ms=400,
        smart_format=True,
    )

    # Fallback: Webhook 장애 시 Claude Haiku로 자동 전환
    fallback_llm = AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model="claude-haiku-4-5-20251001",
        system_prompt="간단히 답변해주세요. 시스템 장애로 상세 응답이 어렵습니다.",
        max_tokens=128,
    )

    # Webhook LLM — n8n/Flowise/사내API 연동
    webhook_llm = WebhookAdapter(
        url=os.environ.get("WEBHOOK_URL", "https://n8n.company.com/webhook/voice-bot"),
        timeout=5.0,           # 5초 타임아웃
        secret=os.environ.get("WEBHOOK_SECRET", ""),  # HMAC 서명
        fallback=fallback_llm,
        system_prompt="당신은 고객 상담 AI입니다. 짧고 명확하게 답변하세요.",
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
    )

    print("🔗 Webhook 연동 AI 음성 봇 시작...")
    print(f"   Webhook URL: {os.environ.get('WEBHOOK_URL', '(환경변수 미설정)')}")
    print("   Fallback:    Claude Haiku (5초 타임아웃 시 자동 전환)")
    print()

    await (
        gw.pipeline()
        .stt(stt)
        .llm(webhook_llm)
        .tts(tts)
        .on_new_call(lambda s: print(f"📞 [{s.linked_id}] 콜 수신: {s.caller or '비공개'}"))
        .on_transcript(
            lambda r, s: print(f'💬 [{s.linked_id}] "{r.text}"') if r.is_final else None
        )
        .on_call_ended(lambda lid, dur: print(f"📴 [{lid}] 통화 종료 ({dur}초)"))
        .on_error(lambda err, lid=None: print(f"❌ [{lid or 'global'}] {err}"))
        .start()
    )


if __name__ == "__main__":
    asyncio.run(main())
