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

