# 이벤트 후킹 및 폴백 설정

## 11. 이벤트 후킹 — 통화 시작·종료·발화 감지

파이프라인의 `.on*(...)` 메서드로 이벤트를 후킹할 수 있습니다.

```typescript
gw.pipeline()
  .stt(stt).llm(llm).tts(tts)

  // 새 통화가 시작될 때 호출
  .onNewCall(async (session) => {
    console.log(
      `📞 새 콜 수신\n` +
      `   linkedId   : ${session.linkedId}\n` +
      `   발신자번호  : ${session.caller ?? '알 수 없음'}\n` +
      `   발신자이름  : ${session.callerName ?? '알 수 없음'}\n` +
      `   DID 번호    : ${session.did ?? '알 수 없음'}\n` +
      `   착신번호    : ${session.callee ?? '알 수 없음'}`
      // ── session에서 추가로 출력할 수 있는 필드 ──
      // + `\n   콜 ID      : ${session.callId}`
      // + `\n   상담원내선  : ${session.agentNumber}`
      // + `\n   방향        : ${session.dir}`           // 'in' | 'out' | 'both'
      // + `\n   컨퍼런스ID  : ${session.confId}`
      // + `\n   테넌트 ID   : ${session.tenantId}`
      // + `\n   커스텀 1    : ${session.customValue1}`  // 다이얼플랜에서 전달한 사용자 정의 변수
      // + `\n   커스텀 2    : ${session.customValue2}`
      // + `\n   커스텀 3    : ${session.customValue3}`
      // + `\n   시작시각    : ${session.startedAt}`
      // + `\n   스트림 URL  : ${session.streamUrl}`
      // + `\n   메타데이터  : ${JSON.stringify(session.metadata)}`
    );
    // 예: DB에 통화 기록 저장, 인사말 재생 등
  })

  // 발화가 인식될 때마다 호출 (중간 + 최종)
  .onTranscript(async (result, session) => {
    if (!result.isFinal) {
      // 중간 결과 (아직 말하는 중)
      process.stdout.write(`\r${result.text}`);
    } else {
      // 최종 결과 (발화 완료)
      console.log(`\n[최종] ${result.speaker}: ${result.text}`);
      // 예: DB에 전사 저장, 웹훅 호출 등
    }
  })

  // 통화가 종료될 때 호출
  .onCallEnded(async (linkedId, durationSec) => {
    console.log(`통화 종료: ${linkedId} (${durationSec}초)`);
    // 예: 통화 요약 생성, 정산 처리 등
  })

  // 오류 발생 시 호출
  .onError((err, linkedId) => {
    console.error(`오류 [${linkedId ?? 'unknown'}]: ${err.message}`);
    // 예: 알림 발송, 오류 로그 기록 등
  })

  .start();
```

### session 객체 전체 필드 참조

`onNewCall` / `on_new_call` 콜백에 전달되는 `session` 객체의 전체 필드 목록입니다.

| 필드 (TS / Python) | 타입 | 설명 |
|---|---|---|
| `linkedId` / `linked_id` | `string` | Dynamic VoIP Linked ID (통화 그룹 식별자) |
| `caller` | `string?` | 발신자 전화번호 (`CALLERID(num)`) |
| `callerName` / `caller_name` | `string?` | 발신자 표시 이름 (`CALLERID(name)`) |
| `callee` | `string?` | 착신번호 (B-leg / EXTEN) |
| `did` | `string?` | DID (Direct Inward Dialing) 대표번호 |
| `callId` / `call_id` | `string?` | 업무 시스템 통화 ID (CRM 등 ARI args) |
| `agentNumber` / `agent_number` | `string?` | 상담원 내선번호 |
| `dir` | `'in' \| 'out' \| 'both'` | 오디오 스트림 방향 |
| `confId` / `conf_id` | `string?` | ConfBridge 컨퍼런스 ID |
| `tenantId` / `tenant_id` | `string?` | 멀티테넌트 ID |
| `customValue1` / `custom_value_1` | `string?` | 사용자 정의 변수 1 (다이얼플랜 `CUSTOM_VALUE_01`) |
| `customValue2` / `custom_value_2` | `string?` | 사용자 정의 변수 2 (다이얼플랜 `CUSTOM_VALUE_02`) |
| `customValue3` / `custom_value_3` | `string?` | 사용자 정의 변수 3 (다이얼플랜 `CUSTOM_VALUE_03`) |
| `startedAt` / `started_at` | `Date` / `datetime` | 통화 시작 시각 |
| `streamUrl` / `stream_url` | `string` | 오디오 WebSocket URL |
| `metadata` | `object` / `dict` | 커스텀 키-값 메타데이터 |

> 💡 `caller_name`, `did`, `callee`, `call_id`, `agent_number`는 Dynamic VoIP ARI에서 전달되는 값이며,
> PBX 설정에 따라 비어 있을 수 있습니다.

### 커스텀 변수 (custom_value) — 다이얼플랜에서 AI 파이프라인으로 전달

Dynamic VoIP 다이얼플랜에서 `CUSTOM_VALUE_01` ~ `CUSTOM_VALUE_03` 변수를 설정하면, AI 파이프라인의 `session` 객체에서 접근할 수 있습니다. CRM 연동, 고객 등급, 캠페인 코드 등 비즈니스 로직에 필요한 정보를 전달하는 데 사용합니다.

**전체 데이터 흐름:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Dynamic VoIP Dialplan                                                  │
│                                                                         │
│  Set(CUSTOM_VALUE_01=홍길동)     ← 고객명 (CRM 조회 결과)               │
│  Set(CUSTOM_VALUE_02=ORD-001)   ← 주문번호 (Originate 시 전달)         │
│  Set(CUSTOM_VALUE_03=happycall) ← 통화 목적 (캠페인 코드)              │
│                                                                         │
│  Stasis(dvgateway, ..., custom_value_01=${CUSTOM_VALUE_01},             │
│         custom_value_02=${CUSTOM_VALUE_02},                             │
│         custom_value_03=${CUSTOM_VALUE_03})                             │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DVGateway (Go 미디어 게이트웨이)                                        │
│                                                                         │
│  ARI ParseArgs() → CallArgs.CustomValue1/2/3                           │
│       │                                                                 │
│       ├─→ Registry.CallMeta  (세션 메타데이터에 저장)                    │
│       │                                                                 │
│       ├─→ CallInfo Hub ──→ call:new 이벤트에 포함                       │
│       │   {                                                             │
│       │     "event": "call:new",                                        │
│       │     "customValue1": "홍길동",                                    │
│       │     "customValue2": "ORD-001",                                  │
│       │     "customValue3": "happycall"                                 │
│       │   }                                                             │
│       │                                                                 │
│       ├─→ CDR Record ──→ JSON Lines / SQLite 영속 저장                  │
│       │                                                                 │
│       └─→ Session API ──→ GET /api/v1/sessions/{linkedId} 응답          │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │  WebSocket (call:new 이벤트)
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SDK (TypeScript / Python)                                              │
│                                                                         │
│  .onNewCall(async (session) => {                                        │
│      session.customValue1   // "홍길동"      (TypeScript)               │
│      session.customValue2   // "ORD-001"     (TypeScript)               │
│      session.customValue3   // "happycall"   (TypeScript)               │
│                                                                         │
│      session.custom_value_1 // "홍길동"      (Python)                   │
│      session.custom_value_2 // "ORD-001"     (Python)                   │
│      session.custom_value_3 // "happycall"   (Python)                   │
│  })                                                                     │
│                                                                         │
│  활용 예시:                                                              │
│  ┌──────────────────────┬────────────────────────────────────────┐      │
│  │ 활용 패턴             │ 코드 예시                               │      │
│  ├──────────────────────┼────────────────────────────────────────┤      │
│  │ TTS 인사말에 고객명    │ gw.say(id, `${cv1}님 안녕하세요`)     │      │
│  │ LLM 프롬프트 주입     │ llm.setSystemPrompt(`고객: ${cv1}`)   │      │
│  │ 통화 목적별 분기      │ if (cv3 === 'happycall') { ... }      │      │
│  │ 외부 API 조회 키      │ crm.lookup(cv2) // 주문번호로 조회     │      │
│  └──────────────────────┴────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

**다이얼플랜 예제 (Dynamic VoIP extensions.conf):**

```ini
; 인바운드 통화에 커스텀 변수를 설정하는 예
[from-trunk]
exten => _X.,1,NoOp(인바운드 콜 처리)
 same => n,Set(CUSTOM_VALUE_01=vip)            ; 고객 등급
 same => n,Set(CUSTOM_VALUE_02=campaign-2026Q1) ; 캠페인 코드
 same => n,Set(CUSTOM_VALUE_03=${CDR(uniqueid)}) ; 외부 시스템 고유 ID
 same => n,Stasis(dvgateway,mode=both,role=monitor,did=${DID_NUMBER},callernum=${CALLERID(num)},callername=${CALLERID(name)},callednum=${EXTEN},custom_value_01=${CUSTOM_VALUE_01},custom_value_02=${CUSTOM_VALUE_02},custom_value_03=${CUSTOM_VALUE_03})
 same => n,Dial(SIP/${EXTEN},30)
```

**SDK에서 활용 — TypeScript:**

```typescript
gw.pipeline()
  .stt(stt).llm(llm).tts(tts)
  .onNewCall(async (session) => {
    const grade = session.customValue1;     // "vip"
    const campaign = session.customValue2;  // "campaign-2026Q1"
    const extId = session.customValue3;     // CDR uniqueid

    // 고객 등급에 따라 LLM 프롬프트를 다르게 설정
    if (grade === 'vip') {
      llm.setSystemPrompt('VIP 고객입니다. 최우선으로 응대해 주세요.');
    }
    console.log(`캠페인: ${campaign}, 외부 ID: ${extId}`);
  })
  .start();
```

**SDK에서 활용 — Python:**

```python
@gw.on("call:new")
async def on_new_call(event):
    session = event["session"]
    grade    = session.custom_value_1    # "vip"
    campaign = session.custom_value_2    # "campaign-2026Q1"
    ext_id   = session.custom_value_3    # CDR uniqueid

    if grade == "vip":
        llm.set_system_prompt("VIP 고객입니다. 최우선으로 응대해 주세요.")
    print(f"캠페인: {campaign}, 외부 ID: {ext_id}")
```

**CDR (통화 기록)에도 저장:** 커스텀 변수는 CDR에 자동 기록되며, CSV/JSON 내보내기와 REST API 조회 시 `customValue1`, `customValue2`, `customValue3` 필드로 포함됩니다.

---

## 11-A. TTS 재생 완료 이벤트 — `tts:complete` (v1.4+)

### 개요

SDK의 `injectTts()` / `inject_tts()` / `say()` 는 오디오 iterator가 소진되면 즉시 반환됩니다. 그러나 **게이트웨이가 실제로 Asterisk에 모든 프레임을 주입 완료한 시점이 아닙니다**. 게이트웨이의 TTS Player는 20ms 틱 기반 루프로 프레임을 밀어넣기 때문에, 6초짜리 TTS는 대략 6초간 Asterisk에 계속 프레임을 공급합니다.

`tts:complete` 이벤트는 게이트웨이가 **실제 재생 완료 시점**에 발행하는 authoritative 신호입니다.

### 발생 시점

- `Player.Play()` 세션 정상 EOF 종료 (페이드아웃 포함 모든 프레임 Asterisk로 전송 완료)
- 명시적 `Stop()` 호출로 중단
- 동시 `Play()` 호출에 의한 선점 (stale 세션은 발행 안 함 — 중복 알림 방지)

### 의미

게이트웨이 → Asterisk WebSocket 주입 완료. Asterisk → 전화기 RTP 버퍼 지연(~20–40ms)은 고려 안 됨. IVR / 음성봇 턴 관리 용도로는 무의미한 수준의 차이입니다.

### 주요 활용 사례

| 사례 | 설명 |
|------|------|
| **순차 TTS 재생** | 인사말 → 메뉴 안내 체이닝 (overlap 방지) |
| **고객 VAD 리오픈** | AI 응답이 끝날 때까지 고객 발화 차단 유지 |
| **S2S AI 발화 종료 감지** | OpenAI Realtime / Gemini Live 응답 완료 시점 정확히 포착 |
| **통화 스크립트 진행 제어** | "안내 끝났으니 상담원 연결" 같은 흐름 제어 |
| **지연 분석 로깅** | 합성 요청 → 실제 재생 완료까지 정확한 레이턴시 측정 |

### TypeScript 사용법

**방법 A — `onTtsComplete()` 전용 헬퍼 (권장)**

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import type { TTSCompleteEvent } from 'dvgateway-sdk';

// 인사말이 끝난 직후 메뉴 재생
await gw.injectTts(linkedId, welcomeTts.synthesize('안녕하세요'));

const unsub = gw.onTtsComplete(async (ev: TTSCompleteEvent) => {
  if (ev.linkedId !== linkedId) return;   // 다른 통화의 이벤트 무시
  await gw.injectTts(linkedId, menuTts.synthesize('1번을 눌러주세요'));
  unsub();  // 한 번만 재생하고 구독 해지
});
```

**방법 B — `onCallEvent()` 로 전체 이벤트 받기**

```typescript
gw.onCallEvent(async (event) => {
  switch (event.type) {
    case 'call:new':
      await gw.injectTts(event.session.linkedId, welcomeTts.synthesize('환영합니다'));
      break;
    case 'tts:complete':
      console.log(`재생 완료: ${event.linkedId} (서버: ${event.serverId})`);
      break;
    case 'call:ended':
      console.log(`통화 종료: ${event.linkedId} (${event.durationSec}초)`);
      break;
  }
});
```

### Python 사용법

```python
from dvgateway import DVGatewayClient, TTSCompleteEvent

# 인사말 재생 후 메뉴 안내 체이닝
await gw.inject_tts(linked_id, welcome_tts.synthesize("안녕하세요"))

def on_done(ev: TTSCompleteEvent) -> None:
    if ev.linked_id != linked_id:
        return
    asyncio.ensure_future(
        gw.inject_tts(linked_id, menu_tts.synthesize("1번을 눌러주세요"))
    )

unsub = gw.on_tts_complete(on_done)
# 필요시 unsub() 호출로 구독 해지
```

### 실전 예제 — IVR 순차 안내

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { GoogleChirp3Adapter } from 'dvgateway-adapters/stt';
import { OpenAITtsAdapter } from 'dvgateway-adapters/tts';

const gw = new DVGatewayClient({ baseUrl, auth });
const tts = new OpenAITtsAdapter({ apiKey });

// 다단계 안내 스크립트
const scripts = [
  '(주)올소 고객센터입니다.',
  '상담 품질 향상을 위해 통화가 녹음됩니다.',
  '한국어는 1번, 영어는 2번을 눌러주세요.',
];

gw.onCallEvent(async (event) => {
  if (event.type !== 'call:new') return;
  const lid = event.session.linkedId;
  let step = 0;

  const playNext = async () => {
    if (step >= scripts.length) return;
    await gw.injectTts(lid, tts.synthesize(scripts[step++]));
  };

  // 초기 안내 시작
  await playNext();

  // 각 안내 완료마다 다음 안내 재생
  const unsub = gw.onTtsComplete(async (ev) => {
    if (ev.linkedId !== lid) return;
    if (step >= scripts.length) {
      unsub();  // 모든 안내 끝, DTMF 대기 단계로 전환
      return;
    }
    await playNext();
  });
});

await gw.connect();
```

### S2S (OpenAI Realtime / Gemini Live) 와의 연동

S2S 어댑터의 `onAudioOutput` 콜백으로 받은 PCM을 `gw.injectTts()` 로 주입하면, AI 응답 한 턴이 끝날 때마다 `tts:complete` 이벤트가 발행됩니다. 이를 이용해 "AI 발화 종료 시점"을 정확히 감지할 수 있습니다.

```typescript
// S2S 응답 종료 시점 포착 → 대화 로그 기록 / 후속 조치
realtime.onAudioOutput(async (pcm16k, linkedId) => {
  await gw.injectTts(linkedId, (async function* () { yield pcm16k; })());
});

gw.onTtsComplete((ev) => {
  console.log(`AI 응답 종료: ${ev.linkedId} @ ${ev.timestamp.toISOString()}`);
  // 예: 응답 내용 DB 저장, 고객 VAD 재개, 턴 카운터 증가 등
});
```

### 이벤트 타입 전체 목록

| 이벤트 | 발생 시점 | 주요 페이로드 |
|--------|-----------|-------------|
| `call:new` | 새 통화 시작 | `session` (CallSession 전체), `tenantId` |
| `call:ended` | 통화 종료 | `linkedId`, `durationSec` |
| `conf:join` | 회의 참여 | `linkedId`, `confId`, `caller` |
| `conf:leave` | 회의 퇴장 | `linkedId`, `confId` |
| `conf:ended` | 회의 종료 | `confId` |
| **`tts:complete`** | **TTS 재생 완료 (v1.4+)** | **`linkedId`, `tenantId`, `serverId`, `timestamp`** |

### Wire format (`/api/v1/ws/callinfo`)

```json
{
  "event":    "tts:complete",
  "linkedId": "1775805184.495",
  "tenantId": "7be69580e27641df",
  "serverId": "gw-seoul-01"
}
```

테넌트 필터링: 테넌트 JWT로 connect한 구독자는 **해당 테넌트 이벤트만** 수신합니다. 관리자 연결(테넌트 ID 없음)은 모든 테넌트 이벤트 수신.

### 주의사항

1. **`tts:complete`는 `injectTts()` Promise 해결 이후에 발행됩니다** — Promise는 iterator 소진 시점에 resolve되고, 실제 재생은 그 이후에도 계속되므로 순서상 이벤트가 나중에 옵니다.

2. **여러 통화 동시 핸들링 시 `linkedId` 필터 필수** — 콜백은 전역으로 등록되므로 반드시 `ev.linkedId === myLinkedId` 체크.

3. **`Stop()` 이나 선점으로 중단된 경우도 발행됩니다** — "정상 완료"와 "중단"을 구분하고 싶다면 애플리케이션 레벨에서 상태 추적 필요. 게이트웨이는 "재생 루프가 끝났음" 만 알림.

4. **S2S 모드에서 응답이 매우 긴 경우** — OpenAI/Gemini는 턴 단위로 오디오를 나눠 보내기도 합니다. 각 청크를 별도로 `injectTts()` 하면 `tts:complete`도 청크별로 발생. 한 턴 = 한 이벤트로 받고 싶다면 청크를 모아 한 번에 주입하세요.

---

## 12. 폴백(Fallback) 설정 — 장애 자동 전환

주 서비스 장애 시 자동으로 백업 서비스로 전환합니다.

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, OpenAITtsAdapter } from 'dvgateway-adapters/tts';

await gw.pipeline()
  // STT: Deepgram 장애 시 폴백 없음 (단일 서비스)
  .stt(new DeepgramAdapter({ apiKey: process.env.DEEPGRAM_API_KEY!, language: 'ko' }))

  // LLM: OpenAI 장애 시 Anthropic으로 자동 전환
  .llm(new OpenAILlmAdapter({ apiKey: process.env.OPENAI_API_KEY! }))
  .fallback(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }))

  // TTS: ElevenLabs 장애 시 OpenAI TTS로 자동 전환
  .tts(new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY! }))
  .fallback(new OpenAITtsAdapter({ apiKey: process.env.OPENAI_API_KEY! }))

  .start();
```

---

