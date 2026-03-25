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
  //   gpt-4o-realtime-preview          — 최고 품질 (기본값)
  //   gpt-4o-mini-realtime-preview     — 비용 절감형 (Audio 1.5)
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

## 9. 파이프라인 패턴 3: 컨퍼런스 자동 회의록

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

