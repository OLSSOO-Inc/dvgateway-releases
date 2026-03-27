"""
Example 6: Pipeline Hooks — RAG 컨텍스트 주입 + DB 연동 + 히스토리 관리

on_before_chat / on_after_chat 훅을 사용하여:
  1. 사용자 발화 시 벡터 DB에서 관련 문서를 검색하여 LLM 컨텍스트에 주입 (RAG)
  2. 사내 REST API에서 고객 정보를 조회하여 개인화 응대
  3. 대화 히스토리를 DB에 저장 (상담 기록 보관)
  4. max_turns로 대화 히스토리 자동 관리

Architecture:

  고객 발화 → STT → on_before_chat ─┬→ 벡터DB 검색 (RAG)
                                      ├→ 사내API 고객정보 조회
                                      └→ 컨텍스트 주입된 messages
                                             ↓
                                           LLM → on_after_chat ─→ DB 저장
                                             ↓
                                           TTS → 통화 재생

Run:
  cp .env.example .env
  python examples/python/06_pipeline_hooks_rag.py
"""

import asyncio
import os
from dataclasses import dataclass

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter, GeminiTtsAdapter
from dvgateway.types import HookContext, HistoryOptions, Message

load_dotenv()

# ─── 0. 사내 시스템 시뮬레이션 ──────────────────────────────────────────────


@dataclass
class CustomerInfo:
    name: str
    tier: str
    last_order: str = ""
    open_tickets: int = 0


# 통화별 고객 정보 캐시
_customer_cache: dict[str, CustomerInfo | None] = {}


async def search_vector_db(query: str) -> list[str]:
    """
    벡터 DB 검색 — Pinecone, Qdrant, ChromaDB 등으로 교체 가능

    실제 구현 예시 (ChromaDB):
        import chromadb
        client = chromadb.Client()
        collection = client.get_collection("faq_docs")
        results = collection.query(query_texts=[query], n_results=3)
        return results["documents"][0]
    """
    print(f"   🔍 [벡터DB] 검색: \"{query[:40]}...\"")

    # FAQ 시뮬레이션
    faq_docs = {
        "배송": "배송은 주문 후 2-3일 소요됩니다. 제주·도서 지역은 1-2일 추가됩니다.",
        "반품": "반품은 수령 후 7일 이내 가능합니다. 고객센터에서 반품 접수 후 택배 수거합니다.",
        "교환": "동일 상품 교환은 무료이며, 다른 상품 교환 시 차액이 발생할 수 있습니다.",
        "결제": "신용카드, 계좌이체, 카카오페이, 네이버페이를 지원합니다.",
        "영업시간": "평일 09:00~18:00, 토요일 09:00~13:00, 일요일·공휴일은 휴무입니다.",
    }

    results = [doc for keyword, doc in faq_docs.items() if keyword in query]
    if not results:
        results = ["고객센터 운영시간: 평일 09:00~18:00"]

    print(f"   📄 [벡터DB] {len(results)}건 검색됨")
    return results


async def lookup_customer(caller_number: str) -> CustomerInfo | None:
    """
    사내 CRM API — 고객 정보 조회

    실제 구현 예시:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{CRM_API_URL}/customers/by-phone/{caller_number}",
                headers={"Authorization": f"Bearer {CRM_TOKEN}"},
                timeout=aiohttp.ClientTimeout(total=3),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return CustomerInfo(**data)
        return None
    """
    print(f"   👤 [CRM] 고객 조회: {caller_number}")

    if caller_number and caller_number.endswith("1234"):
        return CustomerInfo(name="김철수", tier="VIP", last_order="노트북 Pro 15", open_tickets=1)
    return CustomerInfo(name="고객", tier="Standard")


async def save_conversation(
    linked_id: str, turn_number: int, user_text: str, assistant_text: str
) -> None:
    """
    대화 기록 DB 저장 — PostgreSQL, MySQL, MongoDB 등으로 교체 가능

    실제 구현 예시 (asyncpg):
        import asyncpg
        conn = await asyncpg.connect(DATABASE_URL)
        await conn.execute(
            "INSERT INTO conversations (linked_id, turn, user_text, assistant_text, ts) "
            "VALUES ($1, $2, $3, $4, NOW())",
            linked_id, turn_number, user_text, assistant_text,
        )
    """
    print(f"   💾 [DB] 대화 저장: turn={turn_number}, linked_id={linked_id[:8]}...")


# ─── 1. 파이프라인 훅 정의 ──────────────────────────────────────────────────


async def before_chat_hook(messages: list[Message], ctx: HookContext) -> list[Message]:
    """LLM 호출 전: RAG 검색 + 고객 정보 주입"""
    # 마지막 사용자 메시지 찾기
    user_msgs = [m for m in messages if m.role == "user"]
    if not user_msgs:
        return messages

    last_user = user_msgs[-1]
    print(f"\n🔗 [Hook:on_before_chat] turn={ctx.turn_number}")

    # 1) 벡터 DB 검색
    docs = await search_vector_db(last_user.content)

    # 2) 캐시된 고객 정보
    customer = _customer_cache.get(ctx.session.linked_id)

    # 3) 컨텍스트 시스템 메시지 생성
    context_text = (
        f"[참고 문서]\n{chr(10).join(docs)}\n\n"
        f"[고객 정보]\n"
        f"이름: {customer.name if customer else '미확인'}\n"
        f"등급: {customer.tier if customer else '일반'}\n"
    )
    if customer and customer.last_order:
        context_text += f"최근 주문: {customer.last_order}\n"
    if customer and customer.open_tickets:
        context_text += f"진행 중 문의: {customer.open_tickets}건\n"

    context_msg = Message(role="system", content=context_text)

    # 시스템 프롬프트 바로 뒤에 삽입
    result = list(messages)
    sys_idx = next((i for i, m in enumerate(result) if m.role == "system"), -1)
    result.insert(sys_idx + 1, context_msg)
    return result


async def after_chat_hook(response: str, messages: list[Message], ctx: HookContext) -> str:
    """LLM 응답 후: DB 저장 + 후처리"""
    print(f"🔗 [Hook:on_after_chat] turn={ctx.turn_number}")

    user_msgs = [m for m in messages if m.role == "user"]
    user_text = user_msgs[-1].content if user_msgs else ""
    await save_conversation(ctx.session.linked_id, ctx.turn_number, user_text, response)

    return response  # 수정 없이 반환 (필요 시 응답 텍스트 변경 가능)


# ─── 2. 메인 실행 ────────────────────────────────────────────────────────


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

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt=(
            "당신은 OLSSOO Inc.의 AI 고객 상담원입니다. "
            "제공된 [참고 문서]와 [고객 정보]를 활용하여 정확하게 답변하세요. "
            "문서에 없는 내용은 '확인 후 안내드리겠습니다'라고 답하세요. "
            "답변은 1-2문장으로 짧게 해주세요."
        ),
        max_tokens=256,
        temperature=0.3,
    )

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

    print("🎙️  RAG + DB 연동 AI 음성 봇 시작...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_before_chat(before_chat_hook)
        .on_after_chat(after_chat_hook)
        .history(HistoryOptions(max_turns=20, summarize_on_trim=True))
        .on_new_call(lambda session: _on_new_call(session))
        .on_call_ended(lambda lid, dur: print(f"📴 [{lid}] 통화 종료 ({dur}초)\n"))
        .on_error(lambda err, lid=None: print(f"❌ [{lid or 'global'}] {err}"))
        .start()
    )


async def _on_new_call(session) -> None:
    """통화 시작: 고객 정보 사전 조회"""
    print(
        f"📞 [{session.linked_id}] 새 콜: {session.caller or '비공개'}\n"
        f"   커스텀값1   : {session.custom_value_1 or '없음'}\n"
        f"   커스텀값2   : {session.custom_value_2 or '없음'}\n"
        f"   커스텀값3   : {session.custom_value_3 or '없음'}"
    )
    customer = await lookup_customer(session.caller or "")
    _customer_cache[session.linked_id] = customer
    if customer:
        print(f"   👤 고객: {customer.name} ({customer.tier})")


if __name__ == "__main__":
    asyncio.run(main())
