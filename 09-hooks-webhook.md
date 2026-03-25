# 파이프라인 훅 + Webhook 어댑터

## 17. 파이프라인 훅 — RAG 컨텍스트 주입 + DB 연동

파이프라인 빌더에 `onBeforeChat` / `onAfterChat` 훅을 등록하면, LLM 호출 전후에 커스텀 로직을 실행할 수 있습니다.

### onBeforeChat — LLM 호출 전 컨텍스트 주입

사용자가 말을 하면 STT가 텍스트로 변환한 뒤, **LLM을 호출하기 직전에** 실행됩니다. 메시지 배열을 수정하여 반환하면 LLM이 해당 컨텍스트를 참고합니다.

**활용 사례:**
- 벡터 DB에서 관련 문서 검색하여 주입 (RAG)
- 사내 CRM/ERP API에서 고객 정보 조회
- 발화 내용에 따라 시스템 프롬프트 동적 변경
- 특정 키워드 감지 시 전문가 연결 트리거

**TypeScript:**

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import type { Message, HookContext } from 'dvgateway-sdk';

await gw.pipeline()
  .stt(deepgram)
  .llm(claude)
  .tts(elevenlabs)

  .onBeforeChat(async (messages: Message[], ctx: HookContext) => {
    // 마지막 사용자 발화로 벡터 DB 검색
    const lastUser = messages.findLast(m => m.role === 'user');
    const docs = await vectorDB.search(lastUser!.content);

    // CRM에서 고객 정보 조회
    const customer = await crm.getCustomer(ctx.session.caller);

    // 컨텍스트를 시스템 메시지로 주입
    const context: Message = {
      role: 'system',
      content:
        `[참고 문서]\n${docs.join('\n')}\n\n` +
        `[고객 정보] ${customer.name} (${customer.tier}등급)`,
    };

    // 시스템 프롬프트 바로 뒤에 삽입
    const result = [...messages];
    result.splice(1, 0, context);
    return result;
  })

  .start();
```

**Python:**

```python
from dvgateway.types import HookContext, Message

async def before_chat(messages: list[Message], ctx: HookContext) -> list[Message]:
    last_user = [m for m in messages if m.role == "user"][-1]
    docs = await vector_db.search(last_user.content)
    customer = await crm.get_customer(ctx.session.caller)

    context = Message(
        role="system",
        content=f"[참고 문서]\n{chr(10).join(docs)}\n\n[고객 정보] {customer.name}",
    )

    result = list(messages)
    result.insert(1, context)
    return result

await (
    gw.pipeline()
    .stt(stt).llm(llm).tts(tts)
    .on_before_chat(before_chat)
    .start()
)
```

**HookContext 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `session` | CallSession | 현재 통화 세션 (linkedId, caller, did 등) |
| `turnNumber` | number | 현재 대화 턴 번호 (1부터 시작) |
| `pipelineConfig` | PipelineConfig | 대시보드에서 설정한 파이프라인 설정 (선택) |

### onAfterChat — LLM 응답 후 후처리

LLM이 응답을 완료한 직후, TTS 합성 전에 실행됩니다. 응답 텍스트를 수정하거나 로깅/분석에 활용합니다.

**TypeScript:**

```typescript
.onAfterChat(async (response: string, messages: Message[], ctx: HookContext) => {
  // 1) 대화 기록을 DB에 저장
  await db.query(
    'INSERT INTO conversations (linked_id, turn, user_text, ai_text) VALUES ($1,$2,$3,$4)',
    [ctx.session.linkedId, ctx.turnNumber, messages.at(-2)?.content, response]
  );

  // 2) 민감 정보 마스킹 (선택)
  const masked = response.replace(/\d{3}-\d{4}-\d{4}/g, '***-****-****');

  // 3) 수정된 텍스트 반환 (TTS에 전달됨)
  return masked;
})
```

**Python:**

```python
async def after_chat(response: str, messages: list[Message], ctx: HookContext) -> str:
    await db.execute(
        "INSERT INTO conversations (linked_id, turn, user_text, ai_text) VALUES ($1,$2,$3,$4)",
        ctx.session.linked_id, ctx.turn_number, messages[-2].content, response,
    )
    return response

.on_after_chat(after_chat)
```

### 대화 히스토리 관리 (maxTurns, summarize)

장시간 통화 시 대화 히스토리가 무한히 커지는 것을 방지합니다.

```typescript
.history({
  maxTurns: 20,           // 최대 20턴 유지 (user+assistant 쌍)
  summarizeOnTrim: true,  // 초과분을 요약하여 컨텍스트 유지
})
```

```python
from dvgateway.types import HistoryOptions

.history(HistoryOptions(max_turns=20, summarize_on_trim=True))
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `maxTurns` | 0 (무제한) | 유지할 최대 대화 턴 수 |
| `summarizeOnTrim` | false | 트리밍 시 이전 대화 요약 생성 |
| `summarizer` | 내장 | 커스텀 요약 함수 (선택) |

### 사내 DB/API 연동 패턴

훅에서 외부 시스템을 호출할 때 **타임아웃 설정이 중요**합니다. 음성 통화에서 지연은 곧 사용자 불편입니다.

```typescript
// ⚠️ 나쁜 예 — 타임아웃 없음 (DB hang 시 무한 대기)
const data = await db.query('SELECT * FROM customers WHERE phone = $1', [phone]);

// ✅ 좋은 예 — 3초 타임아웃 + fallback
let customer;
try {
  customer = await Promise.race([
    db.query('SELECT * FROM customers WHERE phone = $1', [phone]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]);
} catch {
  customer = { name: '고객', tier: 'Standard' }; // fallback 기본값
}
```

**권장 타임아웃:**

| 시스템 | 권장 타임아웃 | 이유 |
|--------|-------------|------|
| 벡터 DB (Pinecone, Qdrant) | 2~3초 | 검색은 빠르지만 네트워크 변수 |
| 사내 REST API (CRM) | 2~3초 | API 서버 부하 시 지연 |
| RDBMS (PostgreSQL, MySQL) | 1~2초 | 커넥션 풀 사용 시 빠름 |
| 외부 API (Google, Naver) | 3~5초 | 네트워크 지연 |

> **팁:** `onNewCall`에서 고객 정보를 **미리 조회하여 캐시**하면, `onBeforeChat`에서 DB 호출 없이 즉시 사용할 수 있습니다.

---

## 18. Webhook 어댑터 — n8n / Flowise / 사내 API 연동

LLM 호출을 외부 HTTP 엔드포인트로 위임합니다. n8n이나 Flowise 같은 노코드 도구에서 AI 응답 로직을 설계하고, SDK는 해당 엔드포인트만 호출합니다.

### WebhookAdapter 설정

**TypeScript:**

```typescript
import { WebhookAdapter, AnthropicAdapter } from 'dvgateway-adapters';

const webhook = new WebhookAdapter({
  url: 'https://n8n.company.com/webhook/voice-bot',  // Webhook URL
  timeout: 5000,                   // 5초 타임아웃 (초과 시 fallback)
  secret: 'my-hmac-secret',       // HMAC-SHA256 요청 서명 (선택)
  fallback: new AnthropicAdapter({ // Webhook 장애 시 자동 전환
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-haiku-4-5-20251001',
  }),
  headers: {                       // 추가 HTTP 헤더 (선택)
    'Authorization': 'Bearer api-key',
  },
  systemPrompt: '고객 상담 AI입니다.',
});

await gw.pipeline()
  .stt(deepgram)
  .llm(webhook)
  .tts(elevenlabs)
  .start();
```

**Python:**

```python
from dvgateway.adapters.llm import WebhookAdapter, AnthropicAdapter

webhook = WebhookAdapter(
    url="https://n8n.company.com/webhook/voice-bot",
    timeout=5.0,
    secret="my-hmac-secret",
    fallback=AnthropicAdapter(api_key="...", model="claude-haiku-4-5-20251001"),
    system_prompt="고객 상담 AI입니다.",
)

await gw.pipeline().stt(stt).llm(webhook).tts(tts).start()
```

**WebhookAdapter 옵션:**

| 옵션 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `url` | O | — | Webhook 엔드포인트 URL |
| `timeout` | — | 5000ms | 요청 타임아웃 (초과 시 fallback 실행) |
| `secret` | — | (없음) | HMAC-SHA256 서명 키 (X-Webhook-Signature 헤더) |
| `fallback` | — | (없음) | 장애 시 대체 LLM 어댑터 (강력 권장) |
| `headers` | — | {} | 추가 HTTP 헤더 (인증 등) |
| `systemPrompt` | — | 기본 프롬프트 | 시스템 프롬프트 |

### n8n 워크플로우 연동 예시

1. n8n에서 **Webhook** 노드 생성 (POST, JSON body)
2. 수신된 `messages` 배열을 **AI Agent** 또는 **HTTP Request** 노드로 전달
3. LLM 응답을 `{"text": "응답 텍스트"}` 형태로 반환

```
n8n 워크플로우:

[Webhook] → [Set Variables] → [OpenAI Chat] → [Respond to Webhook]
   ↑                                                    ↓
   POST body:                               {"text": "응답 텍스트"}
   {"messages": [...]}
```

**Webhook이 수신하는 요청:**

```json
{
  "messages": [
    {"role": "system", "content": "고객 상담 AI입니다."},
    {"role": "user", "content": "배송이 언제 오나요?"}
  ],
  "model": null,
  "maxTokens": null,
  "temperature": null
}
```

**지원하는 응답 형식:**

| 형식 | 예시 |
|------|------|
| `{"text": "..."}` | 가장 단순 (권장) |
| `{"response": "..."}` | 대안 |
| `{"message": "..."}` | 대안 |
| `{"content": "..."}` | 대안 |
| `{"choices": [{"message": {"content": "..."}}]}` | OpenAI 호환 |
| Plain text body | Content-Type: text/plain |

### Fallback + Timeout 전략

음성 통화에서 Webhook 지연은 **침묵**으로 직결됩니다. 반드시 timeout + fallback을 설정하세요.

```
정상 흐름:     사용자 발화 → Webhook (2초) → TTS 재생  ✅ 자연스러움
타임아웃 흐름: 사용자 발화 → Webhook (5초 초과) → Fallback LLM (0.3초) → TTS  ✅ 지연 최소화
장애 흐름:     사용자 발화 → Webhook (연결 실패) → Fallback LLM (0.3초) → TTS  ✅ 서비스 유지
```

> **권장:** Fallback에는 **가장 빠른 모델** (Claude Haiku, GPT-4o-mini)을 사용하세요.

### 대시보드에서 Webhook 설정

대시보드 **Config → AI 파이프라인** 탭에서 Webhook URL, 타임아웃, 시크릿을 설정할 수 있습니다. 코드 변경 없이 운영 중에도 변경 가능합니다.

1. LLM 프로바이더: **Webhook** 선택
2. Webhook URL 입력 + **연결 확인** 버튼으로 테스트
3. Timeout, Fallback 설정
4. **저장** → 즉시 적용 (재시작 불필요)

> **참고:** 대시보드 설정은 SDK 코드 설정보다 우선순위가 낮습니다. SDK에서 명시적으로 WebhookAdapter를 생성하면 대시보드 설정은 무시됩니다.

---

