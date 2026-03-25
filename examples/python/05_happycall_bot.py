"""
Example 5: HappyCall Bot with Personalized TTS Greeting (Korean)

A realistic outbound satisfaction call bot that:
1. Reads customer info from custom_value_1/2/3 (set in Asterisk dialplan)
2. Greets the customer by name with a TTS greeting before AI pipeline starts
3. Injects order context into the LLM system prompt per call
4. Handles the full STT -> LLM -> TTS conversation loop

Dialplan variables (set via CRM Originate or dialplan Set()):
  CUSTOM_VALUE_01 = customer name  (e.g. "홍길동")
  CUSTOM_VALUE_02 = order ID       (e.g. "ORD-20260321-001")
  CUSTOM_VALUE_03 = call purpose   (e.g. "happycall")

Asterisk dialplan example:
  [outbound-happycall]
  exten => _X.,1,Stasis(dvgateway,mode=customer,did=${CALLERID(num)},\\
    custom_value_01=${CUSTOM_VALUE_01},\\
    custom_value_02=${CUSTOM_VALUE_02},\\
    custom_value_03=${CUSTOM_VALUE_03})

Environment variables (.env):
  DV_BASE_URL=http://<gateway-host>:8080
  DV_API_KEY=dvgw_xxxx...
  DEEPGRAM_API_KEY=...
  OPENAI_API_KEY=...
  ELEVENLABS_API_KEY=...

Run:
  pip install dvgateway-python python-dotenv
  python examples/python/05_happycall_bot.py
"""

import asyncio
import os

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()


async def main() -> None:
    # ─── 1. Gateway client ─────────────────────────────────────────────────
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={
            "type": "apiKey",
            "api_key": os.environ.get("DV_API_KEY", "dev-no-auth"),
        },
        reconnect={
            "max_attempts": 10,
            "initial_delay_ms": 2000,
        },
    )

    # ─── 2. AI adapters ───────────────────────────────────────────────────
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        interim_results=True,
        endpointing_ms=400,
        smart_format=True,
        keywords=["만족", "불만족", "교환", "환불", "배송"],
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        # system_prompt is overridden per call in on_new_call
        system_prompt="당신은 해피콜 AI 상담원 토리입니다.",
        max_tokens=200,
        temperature=0.7,
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        voice_id=os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
        model="eleven_flash_v2_5",
    )

    # ─── 3. Call handlers ──────────────────────────────────────────────────

    async def on_new_call(session):
        """New call — greet customer by name using custom_value_1."""
        customer_name = session.custom_value_1 or "고객"
        order_id = session.custom_value_2 or ""
        call_purpose = session.custom_value_3 or "happycall"

        print(
            f"[해피콜] 통화 시작\n"
            f"  고객명   : {customer_name}\n"
            f"  주문번호 : {order_id or '(없음)'}\n"
            f"  용도     : {call_purpose}\n"
            f"  발신번호 : {session.caller or '알 수 없음'}\n"
            f"  linked_id: {session.linked_id}"
        )

        # ── Inject per-call context into LLM system prompt ──────────
        # The LLM now knows who the customer is and what order to discuss.
        context_lines = [
            "당신은 해피콜 전문 AI 상담원 '토리'입니다.",
            "고객에게 주문 만족도를 확인하는 전화를 걸었습니다.",
            "친절하고 간결하게 응대하세요. 1-2문장으로 답하세요.",
            "",
            f"현재 통화 고객: {customer_name}",
        ]
        if order_id:
            context_lines.append(f"주문번호: {order_id}")
        context_lines.extend([
            "",
            "만족 응답 시 감사 인사 후 종료를 안내하세요.",
            "불만 응답 시 공감하고 담당자 연결을 안내하세요.",
            "추가 문의 시 성실히 답변하세요.",
        ])
        llm.system_prompt = "\n".join(context_lines)

        # ── Play personalized TTS greeting ──────────────────────────
        # custom_value_1 (customer name) is inserted directly into the greeting.
        if order_id:
            greeting = (
                f"안녕하세요 {customer_name} 고객님, 인공지능 상담원 토리입니다. "
                f"주문번호 {order_id} 건에 대해 만족도 확인차 연락드렸습니다. "
                f"서비스에 만족하셨나요?"
            )
        else:
            greeting = (
                f"안녕하세요 {customer_name} 고객님, 인공지능 상담원 토리입니다. "
                f"최근 이용하신 서비스에 대해 만족도 확인차 연락드렸습니다. "
                f"서비스에 만족하셨나요?"
            )

        await gw.say(session.linked_id, greeting, tts)
        print(f"[해피콜] 인사말 재생 완료 -> \"{greeting[:40]}...\"")

    def on_transcript(result, session):
        """Print final transcripts with customer name."""
        if not result.is_final:
            return
        customer_name = session.custom_value_1 or "고객"
        confidence_pct = round((result.confidence or 0) * 100)
        print(f"  {customer_name}: \"{result.text}\" (신뢰도: {confidence_pct}%)")

    def on_call_ended(linked_id, duration):
        print(f"[해피콜] 통화 종료 ({duration}초)\n")

    def on_error(err, linked_id=None):
        print(f"[해피콜] 오류 [{linked_id or 'global'}]: {err}")

    # ─── 4. Start pipeline ─────────────────────────────────────────────────
    print(
        "해피콜 봇 시작...\n"
        f"게이트웨이: {os.environ.get('DV_BASE_URL', 'http://localhost:8080')}\n"
        "전화를 기다리는 중...\n"
    )

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
