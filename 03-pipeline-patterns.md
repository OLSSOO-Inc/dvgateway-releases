# 파이프라인 패턴

## 7. 파이프라인 패턴 1: 일반 통화 STT→LLM→TTS

가장 보편적인 패턴입니다. 각 단계를 독립적으로 제어할 수 있습니다.

```
통화 음성 → [STT: 텍스트 변환] → [LLM: AI 응답 생성] → [TTS: 음성 합성] → 통화에 재생
```

지연 시간 목표: **500ms 이하** (STT ~200ms + LLM ~80ms + TTS ~75ms)

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

await gw.pipeline()
  // STT 어댑터 설정
  .stt(new DeepgramAdapter({
    apiKey:         process.env.DEEPGRAM_API_KEY!,
    language:       'ko',
    model:          'nova-3',
    diarize:        true,         // 화자 구분 활성화
    smartFormat:    true,         // 자동 문장부호
    endpointingMs:  400,          // 발화 종료 감지 (ms)
    interimResults: false,        // 중간 결과 비활성화 (파이프라인에서는 불필요)
  }))
  // LLM 어댑터 설정 (OpenAI 기본, Anthropic 백업)
  .llm(new OpenAILlmAdapter({
    apiKey:       process.env.OPENAI_API_KEY!,
    model:        'gpt-4o-mini',
    systemPrompt: `당신은 OLSSOO Inc.의 고객 상담 AI입니다.
- 짧고 명확하게 답변하세요 (2–3문장).
- 항상 한국어로 응답하세요.
- 모르는 내용은 솔직히 모른다고 하세요.`,
    maxTokens:   512,
    temperature: 0.6,
  }))
  .fallback(new AnthropicAdapter({
    apiKey:       process.env.ANTHROPIC_API_KEY!,
    model:        'claude-sonnet-4-6',
    systemPrompt: `당신은 주식회사 얼쑤팩토리의 고객 상담 AI입니다.
- 짧고 명확하게 답변하세요 (2–3문장).
- 항상 한국어로 응답하세요.
- 모르는 내용은 솔직히 모른다고 하세요.`,
  }))
  // TTS 어댑터 설정
  .tts(new ElevenLabsAdapter({
    apiKey:                  process.env.ELEVENLABS_API_KEY!,
    model:                   'eleven_flash_v2_5',
    voiceId:                 'YOUR_KOREAN_VOICE_ID',  // ElevenLabs 음성 라이브러리에서 선택
    stability:               0.55,
    similarityBoost:         0.75,
    optimizeStreamingLatency: 4,
  }))
  // 인바운드 오디오만 처리 (고객 발화만 AI로 전달)
  .audioFilter({ dir: 'in' })
  .onNewCall(async (session) => {
    console.log(
      `📞 통화 시작\n` +
      `   linkedId   : ${session.linkedId}\n` +
      `   발신자번호  : ${session.caller ?? '알 수 없음'}\n` +
      `   발신자이름  : ${session.callerName ?? '알 수 없음'}\n` +
      `   DID 번호    : ${session.did ?? '알 수 없음'}`
    );
  })
  .onTranscript(async (result, session) => {
    if (result.isFinal) {
      console.log(`[${result.speaker ?? '화자'}] ${result.text}`);
    }
  })
  .onCallEnded(async (linkedId, durationSec) => {
    console.log(`통화 종료 | ${linkedId} | ${durationSec}초`);
  })
  .onError((err, linkedId) => {
    console.error(`파이프라인 오류 | ${linkedId}: ${err.message}`);
  })
  .start();
```

---

## 8. 파이프라인 패턴 2: OpenAI 리얼타임 음성 직통 (Audio 1.5)

OpenAI Realtime API는 STT → LLM → TTS 파이프라인을 단일 WebSocket 연결로 대체합니다.
**지연 시간이 ~300ms**로 가장 빠르며, 별도 STT/TTS 서비스가 필요 없습니다.

```
통화 음성 → [OpenAI Realtime (gpt-4o-realtime)] → AI 음성 응답 → 통화에 재생
```

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

// OpenAI Realtime 어댑터 초기화
const realtimeAdapter = new OpenAIRealtimeAdapter({
  apiKey: process.env.OPENAI_API_KEY!,

  // 모델 선택:
  //   gpt-realtime-2                   — 신모델 (GPT-5급 추론, 2026-05)
  //   gpt-realtime-translate           — 실시간 통역
  //   gpt-4o-realtime-preview          — 레거시 (현 SDK 기본값)
  //   gpt-4o-mini-realtime-preview     — 레거시 비용 절감형 (Audio 1.5)
  model: 'gpt-4o-mini-realtime-preview',

  // AI 응답 음성 선택
  voice: 'alloy',   // alloy, echo, nova, shimmer, ash, coral, sage, verse 등

  // 시스템 지시사항 (LLM의 systemPrompt에 해당)
  instructions: `당신은 친절한 한국어 AI 상담원입니다.
- 짧고 자연스러운 대화체로 답변하세요.
- 2–3문장 이내로 답변하세요.
- 고객이 화가 난 경우 먼저 공감하세요.`,

  // 음성 감지 설정 (server_vad: 자동 감지, none: 수동 제어)
  turnDetection: {
    mode:              'server_vad',
    threshold:          0.5,    // 감지 민감도 (0.0–1.0)
    silenceDurationMs:  500,    // 발화 종료까지 침묵 시간 (ms)
    prefixPaddingMs:    300,    // 발화 시작 전 여유 시간 (ms)
  },

  // 사용자 발화 텍스트 변환 여부
  inputTranscription: true,
  temperature: 0.8,
});

// 오디오 출력 → DVGateway TTS 주입
realtimeAdapter.onAudioOutput(async (audioChunk, linkedId) => {
  await gw.injectTts(linkedId, (async function*() { yield audioChunk; })());
});

// 전사 결과 처리
realtimeAdapter.onTranscript((result) => {
  const speaker = result.speaker === 'agent' ? '🤖 AI' : '👤 고객';
  console.log(`${speaker}: ${result.text}`);
});

// 오류 처리
realtimeAdapter.onError((err, linkedId) => {
  console.error(`리얼타임 오류 | ${linkedId}: ${err.message}`);
});

// 통화 이벤트 구독 — 새 통화마다 세션 시작
gw.on('call:new', async (event) => {
  const { session } = event;
  console.log(`📞 리얼타임 세션 시작: ${session.linkedId}`);

  // 통화 오디오 스트림을 리얼타임 어댑터로 연결
  const audioStream = gw.streamAudio(session.linkedId, { dir: 'in' });
  await realtimeAdapter.startSession(session.linkedId, audioStream);
});

gw.on('call:ended', async (event) => {
  console.log(`📴 리얼타임 세션 종료: ${event.linkedId}`);
  await realtimeAdapter.stop(event.linkedId);
});

// 이벤트 루프 유지 (pipeline이 아닌 이벤트 기반 패턴에서는 프로세스 종료 방지)
console.log('🎙️ OpenAI Realtime 봇이 준비되었습니다.');
```

### 리얼타임 통역 모드 (gpt-realtime-translate)

동일한 어댑터로 **실시간 통역 파이프라인**을 구성할 수 있습니다. `model: 'gpt-realtime-translate'` + `inputLanguage` + `outputLanguage` 세 가지만 지정하면 SDK가 OpenAI 통역 가이드 권장 프롬프트(충실 번역, 사족 금지, 고유명사/숫자 보존, 화자 속도 유지)를 자동 생성합니다.

```
통화 음성 (한국어) → [gpt-realtime-translate] → 영어 음성 → 통화에 재생
```

```typescript
const interpreter = new OpenAIRealtimeAdapter({
  apiKey:         process.env['OPENAI_API_KEY']!,
  model:          'gpt-realtime-translate',
  voice:          'alloy',
  inputLanguage:  'ko',  // 발화자 언어
  outputLanguage: 'en',  // 청취자 언어
  // instructions 미지정 시 SDK가 통역 프롬프트 자동 합성
});
```

- 지원 언어: 입력 70+ / 출력 13 (OpenAI Realtime translate 기준).
- 직접 `instructions`를 지정하면 SDK 자동 합성을 덮어쓰므로 도메인 용어집/존댓말 규칙 커스텀 시 사용.
- 실행 가능 예제: [examples/10-realtime-translate-ko-en.ts](../../examples/10-realtime-translate-ko-en.ts) · [examples/python/05_realtime_translate_ko_en.py](../../examples/python/05_realtime_translate_ko_en.py)

### 리얼타임 vs 파이프라인 비교

| 항목 | STT→LLM→TTS 파이프라인 | OpenAI Realtime |
|------|----------------------|----------------|
| 지연 시간 | ~500ms | **~300ms** |
| 비용 | 서비스별 요금 | 단일 요금 (토큰/초) |
| 음성 자연스러움 | 어댑터 TTS 품질 의존 | **자연스러운 억양** |
| AI 교체 유연성 | **자유로움** (Anthropic, OpenAI 등) | OpenAI 한정 |
| 한국어 품질 | Deepgram Nova-3 최고 | 보통 |
| 컨퍼런스 지원 | ✅ | 세션당 1개 |

---

## 9. 파이프라인 패턴 3: VoiceFlow — Stage 그래프 IVR (SDK 1.6.2+, gateway 1.3.9.4+)

위 두 패턴(7, 8)은 **통화 시작 시점부터 양방향 오디오를 항상 부착**하는 모델입니다. IVR / 메뉴 / 폼 입력 / "DTMF로 분기 → 단계별 AI 호출" 같은 시나리오는 단계마다 필요한 자원이 다릅니다 — 메뉴 안내 단계는 TTS만, 콜백 번호 수집 단계는 DTMF만, AI 상담 단계만 풀-듀플렉스. SDK 1.6.2부터는 **VoiceFlow 빌더**로 이 비대칭을 표현할 수 있고, 게이트웨이는 단계별로 ExternalMedia를 만들었다 사라지게 합니다.

### 다이얼플랜 진입

`Stasis()` 호출에 `flow=true` arg를 추가하면 게이트웨이가 ExternalMedia/Bridge를 자동 생성하지 않고 통화를 holding 상태로 둡니다. SDK가 stage onEnter/onExit 시점에 명시적으로 attach/detach REST 호출을 보낼 때만 ExternalMedia가 만들어졌다 사라집니다.

```asterisk
; /etc/asterisk/extensions.conf
;
; VoiceFlow 진입 — flow=true가 핵심.
; 다른 arg(tenantid, callernum, callednum 등)는 일반 Stasis 진입과 동일.
[from-pstn-flow]
exten => _X.,1,NoOp(VoiceFlow inbound from ${CALLERID(num)} to ${EXTEN})
 same => n,Set(TENANTID=acme)
 same => n,Stasis(dvgateway,flow=true,tenantid=${TENANTID},did=${EXTEN},
                  callernum=${CALLERID(num)},callername=${CALLERID(name)},
                  callednum=${EXTEN},timestamp=${EPOCH()})
 same => n,Hangup()

; 비교: 기존 (flow=false / 미지정) — 진입 즉시 ExternalMedia 자동 생성
[from-pstn-classic]
exten => _X.,1,Stasis(dvgateway,role=monitor,tenantid=${TENANTID},did=${EXTEN},
                      callernum=${CALLERID(num)})
 same => n,Hangup()
```

`flow=true`가 없는 모든 통화는 기존 동작 그대로 유지됩니다 — **회귀 영향 0**. 같은 게이트웨이에 두 모드를 공존시킬 수 있고, DID 별로 다이얼플랜에서 분기하면 됩니다.

### 단계 audio 모드와 게이트웨이 자원

| 모드 | REST `dir` | ExternalMedia | 사용 단계 예시 |
|------|-----------|---------------|--------------|
| `'none'` | (없음) | **분리** — 채널은 holding bridge | DTMF 메뉴 대기, 폼 입력, 외부 시스템 응답 대기 |
| `'tts-only'` | `out` | 단방향 (gateway → caller) | 안내 멘트 재생 (STT 비용 0) |
| `'stt-only'` | `in` | 단방향 (caller → gateway) | 발화 녹취·전사만 |
| `'full'` | `both` | 양방향 (기본 AI 대화) | LLM 상담, 풀-듀플렉스 단계 |

### TypeScript 예제

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY! },
});

const tts = new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_KEY! });

// AI 단계용 풀 파이프라인 — 'chat' stage의 onEnter에서 시작
const aiPipeline = gw.pipeline()
  .stt(new DeepgramAdapter({ apiKey: process.env.DEEPGRAM_KEY!, language: 'ko' }))
  .llm(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_KEY!, model: 'claude-opus-4-7' }))
  .tts(tts);

gw.flow()
  // 1단계: 환영 + 메뉴 안내 (TTS만 — STT 비용 0)
  .stage('greet', {
    audio: 'tts-only',
    onEnter: async (ctx) => {
      await ctx.say('안녕하세요. 1번 상담, 2번 콜백 신청, 9번 종료', tts);
    },
    onDtmf: { '1': 'chat', '2': 'callback', '9': 'bye' },
  })
  // 2-A: AI 상담 (양방향, STT+LLM+TTS)
  .stage('chat', {
    audio: 'full',
    onEnter: async (ctx) => {
      await aiPipeline.start();
    },
  })
  // 2-B: 콜백 번호 수집 (오디오 분리 — DTMF만)
  .stage('callback', {
    audio: 'none',
    onEnter: async (ctx) => {
      const r = await ctx.collectDtmf({
        maxDigits: 11,
        terminator: '#',
        timeoutMs: 15_000,
      });
      ctx.setVar('callbackNumber', r.digits);
      ctx.transitionTo('confirm');
    },
  })
  // 2-B-2: 확인 멘트 (TTS만)
  .stage('confirm', {
    audio: 'tts-only',
    onEnter: async (ctx) => {
      const num = ctx.getVar<string>('callbackNumber');
      await ctx.say(`${num}로 다시 연락드리겠습니다.`, tts);
      ctx.transitionTo('bye');
    },
  })
  // 3단계: 종료 인사 + hangup
  .stage('bye', {
    audio: 'tts-only',
    onEnter: async (ctx) => {
      await ctx.say('감사합니다. 안녕히 계세요.', tts);
      await ctx.hangup();
    },
  })
  .startStage('greet')
  .start();

console.log('🌊 VoiceFlow 봇이 준비되었습니다.');
```

### Python 예제

```python
import asyncio
from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

gw = DVGatewayClient(
    base_url="http://your-gateway:8080",
    auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
)
tts = ElevenLabsAdapter(api_key=os.environ["ELEVENLABS_KEY"])

ai_pipeline = (
    gw.pipeline()
      .stt(DeepgramAdapter(api_key=os.environ["DEEPGRAM_KEY"], language="ko"))
      .llm(AnthropicAdapter(api_key=os.environ["ANTHROPIC_KEY"], model="claude-opus-4-7"))
      .tts(tts)
)

async def on_greet(ctx):
    await ctx.say("1번 상담, 2번 콜백, 9번 종료", tts)

async def on_chat(ctx):
    await ai_pipeline.start()

async def on_callback(ctx):
    r = await ctx.collect_dtmf(max_digits=11, terminator="#", timeout_ms=15_000)
    ctx.set_var("callback_number", r.digits)
    ctx.transition_to("confirm")

async def on_confirm(ctx):
    num = ctx.get_var("callback_number")
    await ctx.say(f"{num}로 다시 연락드리겠습니다.", tts)
    ctx.transition_to("bye")

async def on_bye(ctx):
    await ctx.say("감사합니다.", tts)
    await ctx.hangup()

(
    gw.flow()
      .stage("greet",    audio="tts-only", on_enter=on_greet,
             on_dtmf={"1": "chat", "2": "callback", "9": "bye"})
      .stage("chat",     audio="full",     on_enter=on_chat)
      .stage("callback", audio="none",     on_enter=on_callback)
      .stage("confirm",  audio="tts-only", on_enter=on_confirm)
      .stage("bye",      audio="tts-only", on_enter=on_bye)
      .start_stage("greet")
      .start()
)

print("🌊 VoiceFlow 봇이 준비되었습니다.")
```

### 자원 비교 (단계별 ExternalMedia)

```
            ┌── greet ──┐    ┌── callback ──┐    ┌── confirm ──┐
            │ tts-only  │    │    none      │    │  tts-only   │
caller ──┐  │  out 1ch  │    │   (분리)      │    │   out 1ch   │
         ▼  │           │    │              │    │             │
    [holding bridge — 통화 끝까지 유지]  ←━━━━━━━━━━━━━━━━━━━━━━━━┛
         ▲
caller ──┘  └─ ExternalMedia 동적 생성/삭제 ─┘

기존 패턴(7번/8번)
caller ──→ [bridge + ExternalMedia (양방향)] ─── 통화 끝까지 유지 (변동 없음)
```

DTMF는 AMI 채널 레벨에서 흐르므로 ExternalMedia 분리 상태에서도 정상 수신 — `ctx.collectDtmf()`가 그대로 작동합니다.

### 언제 VoiceFlow를 쓰지 말아야 하는가

- **항상 풀-듀플렉스 AI 대화** (예: 위 패턴 7) — `gw.pipeline()` 단독으로 충분. flow=true는 오버헤드만 추가.
- **Click-to-call 발신** — 발신 시점부터 양방향 필요. flow=true 의미 없음.
- **회의 (ConfBridge, 패턴 10)** — 다중 참여자 모델은 flow=true와 호환되지 않음.

### 추가 자료

- 전체 VoiceFlow API 레퍼런스 + FlowContext 헬퍼 표: [packages/SDK-CLAUDE.md "VoiceFlow" 섹션](../../packages/SDK-CLAUDE.md#voiceflow--stage-그래프-ivr-자동화-gateway-1394)
- 직접 `attachAudio` / `detachAudio` 호출 (빌더 없이): 같은 문서의 "직접 attach/detach" 절

---

## 10. 파이프라인 패턴 4: 컨퍼런스 자동 회의록

다자 통화(ConfBridge)에서 각 참여자의 발화를 자동으로 텍스트화합니다.
TTS 응답 없이 **STT만** 사용하는 경우에 적합합니다.

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

// 회의록 저장용 배열
const minutes: Array<{ speaker: string; text: string; time: Date }> = [];

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey:   process.env.DEEPGRAM_API_KEY!,
    language: 'ko',
    model:    'nova-3',
    diarize:  true,    // 화자 구분 필수
  }))
  .forConference()    // ← 컨퍼런스 모드 (TTS 없음)
  .onTranscript(async (result, session) => {
    if (!result.isFinal) return;

    const entry = {
      speaker: result.speaker ?? session.linkedId,
      text:    result.text,
      time:    new Date(result.timestampMs),
    };

    minutes.push(entry);
    console.log(`[${entry.time.toTimeString().slice(0,8)}] ${entry.speaker}: ${entry.text}`);
  })
  .onError((err) => {
    console.error('회의록 오류:', err.message);
  })
  .start();

// 회의 종료 시 회의록 내보내기
process.on('SIGTERM', () => {
  console.log('\n=== 회의록 ===');
  for (const m of minutes) {
    console.log(`[${m.time.toISOString()}] ${m.speaker}: ${m.text}`);
  }
});
```

---

