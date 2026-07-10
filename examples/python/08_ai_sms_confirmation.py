"""
Example 8: AI 응대 + 확인 문자 — "말로 안내하고, 문자로 남긴다"

영업시간 외(또는 부재중) 걸려온 전화를 AI 봇이 받아 예약을 접수하고,
예약이 확정되는 순간 **건 사람의 휴대폰으로 확인 문자(SMS)** 를 보냅니다.
AI 통화와 SMS 가 같은 게이트웨이·같은 대표번호에서 나가는 조합입니다.

동작 원리 (마커 프로토콜):
  1. LLM 시스템 프롬프트에 "예약 확정 시 응답 끝에 [SMS|날짜시간|이름] 태그를
     붙여라"라고 지시합니다.
  2. on_after_chat 훅이 태그를 감지하면 — 태그를 제거한 텍스트만 TTS 로 재생하고
     (고객에게 태그가 읽히지 않음), 발신자 번호로 확인 SMS 를 보냅니다.

사전 조건:
  - SMS 라우팅 설정 완료 (가이드 21-sms.md §0 — 미설정 시 412 sms_disabled)
  - 발신자(caller)가 휴대폰 번호로 수신되는 환경 (비공개 발신은 문자 생략)
  - 본문은 EUC-KR 80바이트(한글 40자) 이내 — build_sms_text 참고

Run:
  cp .env.example .env
  SMS_FROM_EXT=1001 python examples/python/08_ai_sms_confirmation.py
"""

import asyncio
import os
import re

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import GeminiTtsAdapter
from dvgateway.types import HookContext, Message

load_dotenv()

# ─── 0. 클라이언트 (훅에서 send_sms 를 쓰므로 모듈 레벨) ─────────────────────

gw = DVGatewayClient(
    base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
    auth={"type": "apiKey", "api_key": os.environ.get("DV_API_KEY", "dev-no-auth")},
)

# SMS 발신 내선 — 게이트웨이가 이 내선의 실제 번호(external CID)로 발신합니다.
SMS_FROM_EXT = os.environ.get("SMS_FROM_EXT", "1001")

# ─── 1. 통화별 상태 ──────────────────────────────────────────────────────────

_caller_by_linked_id: dict[str, str] = {}  # linked_id → 발신자 번호
_sms_sent: set[str] = set()                # 통화당 1회만 발송

# 마커: [SMS|07/12 14:00|홍길동]
_SMS_TAG = re.compile(r"\[SMS\|([^|\]]+)\|([^\]]+)\]")


def build_sms_text(when: str, name: str) -> str:
    """확인 문자 본문 — EUC-KR 80바이트(한글 40자) 이내로 설계."""
    # 예: "[예약확정] 07/12 14:00 홍길동님. 변경은 이 번호로 전화주세요" (≈60바이트)
    return f"[예약확정] {when} {name}님. 변경은 이 번호로 전화주세요"


# ─── 2. 훅 ───────────────────────────────────────────────────────────────────


async def _on_new_call(session) -> None:
    print(f"📞 [{session.linked_id}] 새 콜: {session.caller or '비공개'}")
    if session.caller:
        _caller_by_linked_id[session.linked_id] = session.caller


async def after_chat_hook(response: str, messages: list[Message], ctx: HookContext) -> str:
    """예약 확정 태그 감지 → 태그 제거(TTS 미재생) + 확인 SMS 발송."""
    m = _SMS_TAG.search(response)
    if not m:
        return response  # 아직 확정 아님 — 그대로 재생

    spoken = _SMS_TAG.sub("", response).strip()  # 태그는 고객에게 읽히지 않음
    when, name = m.group(1).strip(), m.group(2).strip()
    linked_id = ctx.session.linked_id
    caller = _caller_by_linked_id.get(linked_id)

    if not caller:
        print(f"   ⚠️ [{linked_id}] 발신자 번호 없음(비공개) — 문자 생략")
        return spoken
    if linked_id in _sms_sent:  # 통화당 1회
        return spoken

    _sms_sent.add(linked_id)
    try:
        res = await gw.send_sms(
            from_=SMS_FROM_EXT,  # 내선 → 실제 대표번호로 자동 변환
            to=[caller],
            text=build_sms_text(when, name),
        )
        print(f"   📩 [{linked_id}] 확인 문자 발송: {caller} ({res.get('status')})")
    except Exception as e:  # noqa: BLE001 — SMS 미설정(412)이어도 통화는 계속
        print(f"   ❌ [{linked_id}] 문자 발송 실패: {e}")
        _sms_sent.discard(linked_id)  # 다음 턴 재시도 허용
    return spoken


def _on_call_ended(linked_id: str, duration: float) -> None:
    print(f"📴 [{linked_id}] 통화 종료 ({duration}초)\n")
    _caller_by_linked_id.pop(linked_id, None)
    _sms_sent.discard(linked_id)


# ─── 3. 파이프라인 ───────────────────────────────────────────────────────────


async def main() -> None:
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        endpointing_ms=400,
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt=(
            "당신은 OLSSOO 치과의 영업시간 외 예약 접수원입니다. "
            "지금은 영업시간이 아니므로: 예약 희망 날짜/시간과 성함만 정중히 확인하세요. "
            "답변은 1-2문장으로 짧게. "
            # 마커 프로토콜: 예약 확정 시에만(날짜·시간·이름 모두 확인) 응답 맨 끝에
            # 태그를 정확히 한 번 — 태그는 고객에게 읽히지 않는 시스템 신호.
            "예약 확정 시에만 응답 맨 끝에 [SMS|MM/DD HH:mm|이름] 태그를 붙이세요. "
            '예: "예약되었습니다. 확인 문자를 보내드릴게요.[SMS|07/12 14:00|홍길동]"'
        ),
        max_tokens=256,
        temperature=0.3,
    )

    tts = GeminiTtsAdapter(api_key=os.environ["GEMINI_API_KEY"])

    print("🌙 영업시간 외 AI 예약 접수 봇 (확인 문자 발송) 시작...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(lambda session: _on_new_call(session))
        .on_after_chat(after_chat_hook)
        .on_call_ended(_on_call_ended)
        .on_error(lambda err, lid=None: print(f"❌ [{lid or 'global'}] {err}"))
        .start()
    )


if __name__ == "__main__":
    asyncio.run(main())
