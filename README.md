# DVGateway SDK — 사용 가이드

> **최신 버전: 1.2.5.8** | 업데이트: 2026-03-11

**DVGateway SDK**는 AI 음성 서비스(STT·LLM·TTS)를 실시간 전화 통화에 연결하는 Node.js 라이브러리입니다.
개발자가 아니더라도 이 문서의 예제를 따라 하면 AI 음성 봇을 구축할 수 있습니다.

---

## 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [서버 설치](#2-서버-설치)
3. [SDK 설치](#3-sdk-설치)
4. [API 키 준비](#4-api-키-준비)
5. [5분 만에 시작하기 — 헬로 월드 봇](#5-5분-만에-시작하기--헬로-월드-봇)
6. [연동 가능한 AI 서비스 전체 목록](#6-연동-가능한-ai-서비스-전체-목록)
7. [파이프라인 패턴 1: 일반 통화 STT→LLM→TTS](#7-파이프라인-패턴-1-일반-통화-sttllmtts)
8. [파이프라인 패턴 2: OpenAI 리얼타임 음성 직통 (Audio 1.5)](#8-파이프라인-패턴-2-openai-리얼타임-음성-직통-audio-15)
9. [파이프라인 패턴 3: 컨퍼런스 자동 회의록](#9-파이프라인-패턴-3-컨퍼런스-자동-회의록)
10. [어댑터별 상세 설정](#10-어댑터별-상세-설정)
    - [Deepgram STT](#deepgram-stt-음성-인식)
    - [ElevenLabs TTS](#elevenlabs-tts-음성-합성)
    - [Anthropic Claude LLM](#anthropic-claude-llm)
    - [OpenAI GPT LLM](#openai-gpt-llm)
    - [OpenAI TTS](#openai-tts-음성-합성)
    - [OpenAI 리얼타임 (Speech-to-Speech)](#openai-리얼타임-speech-to-speech)
11. [이벤트 후킹 — 통화 시작·종료·발화 감지](#11-이벤트-후킹--통화-시작종료발화-감지)
12. [폴백(Fallback) 설정 — 장애 자동 전환](#12-폴백fallback-설정--장애-자동-전환)
13. [멀티테넌트 지원](#13-멀티테넌트-지원)
14. [모니터링 대시보드](#14-모니터링-대시보드)
15. [자주 묻는 질문 (FAQ)](#15-자주-묻는-질문-faq)
16. [문제 해결](#16-문제-해결)
17. [원라인 서버 업데이트](#17-원라인-서버-업데이트)

---

## 1. 시스템 요구사항

| 항목 | 최소 요구사항 |
|------|-------------|
| OS | Debian 12/13, Ubuntu 22.04 이상 |
| CPU | 2코어 이상 |
| RAM | 2 GB 이상 (4 GB 권장) |
| Node.js | 20 LTS 이상 |
| 아키텍처 | amd64 / arm64 |
| 네트워크 | 공인 IP 또는 포트 포워딩 (SIP/RTP 수신용) |

---

## 2. 서버 설치

```bash
# 원라인 자동 설치 (Debian/Ubuntu)
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

특정 버전으로 설치하려면 URL의 `latest`를 원하는 버전 태그로 교체하세요:

```bash
# 특정 버전으로 설치 (예: v1.2.3)
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/download/v1.2.3/install.sh | sudo bash
```

설치 가능한 버전 목록은 [GitHub Releases 페이지](https://github.com/OLSSOO-Inc/dvgateway-releases/releases)에서 확인할 수 있습니다.

설치 후 열리는 포트:

| 포트 | 용도 |
|------|------|
| **8080** | SDK API 서버 (AI 클라이언트 연결) |
| **8081** | 웹 대시보드 (모니터링) |
| **8092** | 미디어 서버 내부 WebSocket |
| **8088** | Asterisk ARI (내부용) |

---

## 3. SDK 설치

Node.js 프로젝트 폴더에서 실행합니다.

```bash
# SDK + 어댑터 패키지 설치
npm install dvgateway-sdk dvgateway-adapters
```

TypeScript를 사용하는 경우 (권장):

```bash
npm install --save-dev typescript @types/node
npx tsc --init   # tsconfig.json 생성
```

`tsconfig.json`에 아래 옵션을 추가합니다:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

---

## 4. API 키 준비

사용할 AI 서비스의 API 키가 필요합니다. 아래 표에서 필요한 서비스만 선택하세요.

| 서비스 | 용도 | 발급 주소 | 무료 플랜 |
|--------|------|-----------|-----------|
| **Deepgram** | 음성 → 텍스트 (STT) | https://console.deepgram.com | ✅ $200 크레딧 |
| **ElevenLabs** | 텍스트 → 음성 (TTS) | https://elevenlabs.io | ✅ 월 10,000자 |
| **Anthropic** | AI 대화 (LLM) | https://console.anthropic.com | ❌ 유료 |
| **OpenAI** | AI 대화 / TTS / 리얼타임 | https://platform.openai.com | ❌ 유료 |

API 키는 코드에 직접 쓰지 말고 환경 변수로 관리하세요:

```bash
# .env 파일 생성 (절대 git에 커밋하지 마세요!)
DEEPGRAM_API_KEY=dg_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

```typescript
// 코드에서 환경 변수 읽기
import 'dotenv/config'; // npm install dotenv

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY!;
```

---

## 5. 5분 만에 시작하기 — 헬로 월드 봇

아래 예제는 전화가 오면 자동으로 응답하는 가장 단순한 AI 음성 봇입니다.
**Deepgram(STT) + Claude(LLM) + ElevenLabs(TTS)** 조합을 사용합니다.

```typescript
// bot.ts
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// 1. 게이트웨이 서버에 연결
const gw = new DVGatewayClient({
  baseUrl: 'http://localhost:8080',   // DVGateway 서버 주소
  auth: { type: 'apiKey', apiKey: 'your-gateway-api-key' },
  tenantId: 'tenant-a',              // (선택) 멀티테넌트 환경에서 테넌트 ID 지정
                                     //  설정 시 모든 요청에 X-Tenant-ID 헤더 자동 삽입
});

// 2. AI 어댑터 준비
const stt = new DeepgramAdapter({
  apiKey:   process.env.DEEPGRAM_API_KEY!,
  language: 'ko',          // 한국어 인식
  model:    'nova-3',      // 최고 정확도 모델
});

const llm = new AnthropicAdapter({
  apiKey:       process.env.ANTHROPIC_API_KEY!,
  model:        'claude-haiku-4-5-20251001',   // 가장 빠른 모델
  systemPrompt: '당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.',
});

const tts = new ElevenLabsAdapter({
  apiKey:  process.env.ELEVENLABS_API_KEY!,
  model:   'eleven_flash_v2_5',   // 최저 지연 TTS
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel 음성
});

// 3. 파이프라인 시작 (전화가 오면 자동으로 처리)
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)
  .onNewCall((session) => {
    console.log(`📞 새 통화: ${session.linkedId}`);
  })
  .onTranscript((result) => {
    if (result.isFinal) console.log(`🎙️  발화: ${result.text}`);
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 통화 종료: ${linkedId} (${duration}초)`);
  })
  .onError((err) => {
    console.error('오류:', err.message);
  })
  .start();

console.log('🤖 AI 음성 봇이 시작되었습니다. 전화를 기다리는 중...');
```

실행:

```bash
npx ts-node bot.ts
# 또는 컴파일 후 실행
npx tsc && node dist/bot.js
```

---

## 6. 연동 가능한 AI 서비스 전체 목록

### 음성 인식 (STT — Speech to Text)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **Deepgram** | `DeepgramAdapter` | `nova-3` | 최고 정확도, 한국어 지원, 가장 빠른 스트리밍 |

### 음성 합성 (TTS — Text to Speech)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **ElevenLabs** | `ElevenLabsAdapter` | `eleven_flash_v2_5` | 최저 지연(<75ms), 자연스러운 음성, 한국어 지원 |
| **OpenAI TTS** | `OpenAITtsAdapter` | `tts-1` | 안정적, 여러 언어 지원 |
| **OpenAI 신경망 TTS** | `OpenAITtsAdapter` | `gpt-4o-mini-tts` | 감정 표현, 억양 제어 가능 |

### AI 대화 (LLM — Large Language Model)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **Anthropic Claude** | `AnthropicAdapter` | `claude-haiku-4-5-20251001` | 초저지연, 한국어 우수 |
| **OpenAI GPT** | `OpenAILlmAdapter` | `gpt-4o-mini` | 저렴, 빠름 |

### 실시간 음성-음성 직통 (Realtime Speech-to-Speech)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **OpenAI Realtime** | `OpenAIRealtimeAdapter` | `gpt-4o-realtime-preview` | STT+LLM+TTS 통합, 최저 지연 |
| **OpenAI Realtime Mini** | `OpenAIRealtimeAdapter` | `gpt-4o-mini-realtime-preview` | 비용 효율적, Audio 1.5 엔진 |

---

## 7. 파이프라인 패턴 1: 일반 통화 STT→LLM→TTS

가장 보편적인 패턴입니다. 각 단계를 독립적으로 제어할 수 있습니다.

```
통화 음성 → [STT: 텍스트 변환] → [LLM: AI 응답 생성] → [TTS: 음성 합성] → 통화에 재생
```

지연 시간 목표: **500ms 이하** (STT ~200ms + LLM ~80ms + TTS ~75ms)

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
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
  // LLM 어댑터 설정
  .llm(new AnthropicAdapter({
    apiKey:       process.env.ANTHROPIC_API_KEY!,
    model:        'claude-sonnet-4-6',
    systemPrompt: `당신은 OLSSOO Inc.의 고객 상담 AI입니다.
- 짧고 명확하게 답변하세요 (2–3문장).
- 항상 한국어로 응답하세요.
- 모르는 내용은 솔직히 모른다고 하세요.`,
    maxTokens:   512,
    temperature: 0.6,
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
    console.log(`통화 시작 | linkedId=${session.linkedId} | 발신자=${session.caller}`);
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
  await gw.injectAudio(linkedId, audioChunk);
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
  const audioStream = gw.audioStream(session.linkedId, { dir: 'in' });
  await realtimeAdapter.startSession(session.linkedId, audioStream);
});

gw.on('call:ended', async (event) => {
  console.log(`📴 리얼타임 세션 종료: ${event.linkedId}`);
  await realtimeAdapter.stop(event.linkedId);
});

await gw.connect();
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

## 10. 어댑터별 상세 설정

### Deepgram STT (음성 인식)

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const stt = new DeepgramAdapter({
  apiKey:   'dg_xxxx',

  // ── 언어 및 모델 ──────────────────────────────────────────
  language: 'ko',           // 언어: 'ko' | 'en-US' | 'en-GB' | 'ja' | 'zh' | 'multi'
  model:    'nova-3',       // 모델:
                            //   'nova-3'           — 최고 정확도 (기본값, 한국어+영어)
                            //   'nova-3-general'   — 일반 대화 최적화
                            //   'nova-3-medical'   — 의료 용어 특화
                            //   'nova-3-phonecall' — 전화 통화 품질 최적화

  // ── 발화 감지 ─────────────────────────────────────────────
  endpointingMs:  500,      // 발화 종료 침묵 시간 (ms, 기본값: 500)
  utteranceEndMs: 1000,     // 발화 확정까지 추가 대기 (ms)

  // ── 전사 옵션 ─────────────────────────────────────────────
  interimResults:  true,    // 중간 결과 수신 여부 (기본값: true)
  smartFormat:     true,    // 자동 문장 부호·숫자 형식화
  punctuate:       true,    // 문장부호 추가
  profanityFilter: false,   // 욕설 필터링

  // ── 화자 분리 ─────────────────────────────────────────────
  diarize: true,            // 화자 구분 활성화

  // ── 키워드 강화 (nova-3 전용) ─────────────────────────────
  keywords: ['AI', '게이트웨이', 'OLSSOO'],  // 도메인 특화 단어 인식률 향상
});
```

**모델 선택 가이드:**

| 상황 | 추천 모델 |
|------|---------|
| 일반 고객 상담 (한국어+영어 혼용) | `nova-3` |
| 의료 상담 | `nova-3-medical` |
| 일반 전화 통화 | `nova-3-phonecall` |
| 비용 절감이 필요한 경우 | `base` |

---

### ElevenLabs TTS (음성 합성)

```typescript
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const tts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'eleven_flash_v2_5',
  // 옵션:
  //   'eleven_flash_v2_5'      — 최저 지연 (~75ms), 실시간 최적 (기본값)
  //   'eleven_turbo_v2_5'      — 품질/속도 균형 (~200ms)
  //   'eleven_multilingual_v2' — 최고 다국어 품질 (지연 높음)
  //   'eleven_multilingual_v3' — 차세대 다국어, 향상된 억양 (2026)

  // ── 음성 선택 ─────────────────────────────────────────────
  // ElevenLabs Voice Library에서 한국어 음성 ID를 찾아 입력하세요
  voiceId: 'YOUR_VOICE_ID',

  // ── 음성 품질 설정 ────────────────────────────────────────
  stability:               0.5,   // 안정성 (0.0–1.0, 높을수록 일관됨)
  similarityBoost:         0.75,  // 원본 음성 유사도 (0.0–1.0)
  style:                   0.0,   // 표현력 (0.0–1.0, 높으면 지연 증가)
  useSpeakerBoost:         true,  // 음성 선명도 향상

  // ── 스트리밍 최적화 ───────────────────────────────────────
  optimizeStreamingLatency: 4,    // 0(품질 최대) ~ 4(지연 최소, 기본값)
  outputFormat: 'pcm_24000',      // 내부 포맷 (변경 불필요)
});
```

**한국어 음성 찾기:**
ElevenLabs 콘솔(https://elevenlabs.io/voice-library)에서 "Korean"으로 검색하거나,
자신의 목소리를 클론하여 `voiceId`로 사용할 수 있습니다.

---

### Anthropic Claude LLM

```typescript
import { AnthropicAdapter } from 'dvgateway-adapters/llm';

const llm = new AnthropicAdapter({
  apiKey: 'sk-ant-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'claude-haiku-4-5-20251001',
  // 옵션 (2026-03 기준):
  //   'claude-haiku-4-5-20251001' — 가장 빠름, 저비용 (실시간 음성 권장)
  //   'claude-sonnet-4-6'         — 품질/속도 균형 (기본값)
  //   'claude-opus-4-6'           — 최고 품질, 복잡한 추론

  // ── 대화 설정 ─────────────────────────────────────────────
  systemPrompt: '당신은 친절한 AI 상담원입니다. 짧게 답변하세요.',
  maxTokens:    512,   // 응답 최대 토큰 (짧을수록 빠름)
  temperature:  0.7,   // 창의성 (0.0=정확, 1.0=창의적)
});
```

**모델 선택 가이드:**

| 상황 | 추천 모델 | 예상 지연 |
|------|---------|----------|
| 실시간 음성 봇 | `claude-haiku-4-5-20251001` | ~80ms |
| 복잡한 상담 | `claude-sonnet-4-6` | ~120ms |
| 고품질 분석 | `claude-opus-4-6` | ~200ms |

---

### OpenAI GPT LLM

```typescript
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';

const llm = new OpenAILlmAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'gpt-4o-mini',
  // 옵션 (2026-03 기준):
  //   'gpt-4o-mini' — 빠름, 저비용 (실시간 음성 권장, 기본값)
  //   'gpt-4o'      — 최고 품질, 멀티모달

  // ── 대화 설정 ─────────────────────────────────────────────
  systemPrompt:     '친절한 AI 상담원입니다. 한국어로 짧게 답변하세요.',
  maxTokens:        512,
  temperature:      0.7,
  presencePenalty:  0.1,   // 주제 반복 억제 (0.0–2.0)
  frequencyPenalty: 0.1,   // 표현 반복 억제 (0.0–2.0)
});
```

---

### OpenAI TTS (음성 합성)

```typescript
import { OpenAITtsAdapter } from 'dvgateway-adapters/tts';

const tts = new OpenAITtsAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'tts-1',
  // 옵션:
  //   'tts-1'           — 실시간 최적화 (~200ms, 기본값)
  //   'tts-1-hd'        — 고품질 (스튜디오 수준)
  //   'gpt-4o-mini-tts' — 신경망 TTS, 감정/억양 제어 (2025+)

  // ── 음성 선택 ─────────────────────────────────────────────
  voice: 'nova',
  // 옵션: alloy | echo | fable | onyx | nova | shimmer
  //       ash | ballad | coral | sage | verse  (gpt-4o-mini-tts 전용)

  // ── gpt-4o-mini-tts 전용: 음성 지시사항 ──────────────────
  // model: 'gpt-4o-mini-tts' 사용 시에만 동작
  voiceInstructions: '차분하고 명확한 한국어로 말하세요.',
});
```

---

### OpenAI 리얼타임 (Speech-to-Speech)

```typescript
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const realtime = new OpenAIRealtimeAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'gpt-4o-realtime-preview',
  // 옵션:
  //   'gpt-4o-realtime-preview'           — 최고 품질 (기본값)
  //   'gpt-4o-mini-realtime-preview'      — 비용 절감형 (Audio 1.5)

  // ── AI 음성 선택 ──────────────────────────────────────────
  voice: 'alloy',    // alloy | echo | nova | shimmer | ash | coral | sage | verse

  // ── 시스템 지시사항 ───────────────────────────────────────
  instructions: '친절한 한국어 AI 상담원입니다. 짧고 자연스럽게 답변하세요.',

  // ── 발화 감지 설정 ────────────────────────────────────────
  turnDetection: {
    mode:              'server_vad',  // 자동 발화 감지
    threshold:          0.5,          // 감지 민감도
    silenceDurationMs:  500,          // 종료 판단 침묵 시간
    prefixPaddingMs:    300,          // 발화 시작 여유시간
  },

  // ── 기타 설정 ─────────────────────────────────────────────
  inputTranscription: true,   // 사용자 발화 텍스트 변환
  temperature:        0.8,    // 응답 다양성 (0.6–1.2 권장)
  maxResponseTokens:  'inf',  // 응답 길이 제한 없음 (또는 숫자)
});
```

---

## 11. 이벤트 후킹 — 통화 시작·종료·발화 감지

파이프라인의 `.on*(...)` 메서드로 이벤트를 후킹할 수 있습니다.

```typescript
gw.pipeline()
  .stt(stt).llm(llm).tts(tts)

  // 새 통화가 시작될 때 호출
  .onNewCall(async (session) => {
    console.log(`통화 시작: ${session.linkedId}`);
    console.log(`발신자: ${session.caller}, 수신자: ${session.callee}`);
    console.log(`방향: ${session.dir}`); // 'in' | 'out' | 'both'
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

---

## 12. 폴백(Fallback) 설정 — 장애 자동 전환

주 서비스 장애 시 자동으로 백업 서비스로 전환합니다.

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter, OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, OpenAITtsAdapter } from 'dvgateway-adapters/tts';

await gw.pipeline()
  // STT: Deepgram 장애 시 폴백 없음 (단일 서비스)
  .stt(new DeepgramAdapter({ apiKey: process.env.DEEPGRAM_API_KEY!, language: 'ko' }))

  // LLM: Anthropic 장애 시 OpenAI로 자동 전환
  .llm(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }))
  .fallback(new OpenAILlmAdapter({ apiKey: process.env.OPENAI_API_KEY! }))

  // TTS: ElevenLabs 장애 시 OpenAI TTS로 자동 전환
  .tts(new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY! }))
  .fallback(new OpenAITtsAdapter({ apiKey: process.env.OPENAI_API_KEY! }))

  .start();
```

---

## 13. 멀티테넌트 지원

서버에 `TENANT_CREDENTIALS` 가 설정된 경우 SDK 클라이언트에 `tenantId` 를 지정하여 테넌트 범위로 격리된 운영이 가능합니다.

### DVGatewayClient 옵션

```typescript
const gw = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'your-key' },
  tenantId: 'tenant-a',   // 설정 시 모든 요청에 X-Tenant-ID 헤더 자동 삽입
});
```

### 테넌트별 세션 목록 조회

```typescript
// 현재 tenantId에 속한 활성 세션만 반환
const sessions = await gw.listSessionsByTenant('tenant-a');
console.log(sessions);
// [{ sessionId: '...', tenantId: 'tenant-a', linkedId: '...', state: 'active' }, ...]
```

### call:new 이벤트의 tenantId

```typescript
gw.on('call:new', (event) => {
  const { session } = event;
  console.log(`tenantId: ${session.tenantId}`);    // 통화에 연결된 테넌트 ID
  console.log(`linkedId: ${session.linkedId}`);
});
```

### 멀티테넌트 파이프라인 예시

```typescript
// 테넌트별 독립된 DVGatewayClient 인스턴스 생성
const gwA = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'key-a' },
  tenantId: 'tenant-a',
});

const gwB = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'key-b' },
  tenantId: 'tenant-b',
});

// 각 파이프라인은 해당 테넌트의 통화만 처리
await gwA.pipeline().stt(sttA).llm(llmA).tts(ttsA).start();
await gwB.pipeline().stt(sttB).llm(llmB).tts(ttsB).start();
```

> **참고**: 서버의 `TENANT_LIMITS` 환경변수로 테넌트별 동시통화 한도를 개별 설정할 수 있습니다.
> 예: `TENANT_LIMITS="tenant-a:10,tenant-b:30"`

---

## 14. 모니터링 대시보드

서버 설치 후 웹 브라우저에서 `http://your-server:8081` 에 접속하면
실시간 모니터링 대시보드를 볼 수 있습니다.

**대시보드에서 확인 가능한 항목:**

| 항목 | 설명 |
|------|------|
| 활성 통화 수 | 현재 진행 중인 통화 세션 수 |
| VU 미터 | 각 통화의 실시간 음량 레벨 |
| 지연 시간 | STT/LLM/TTS 각 단계별 처리 시간 |
| 전사 로그 | 실시간 발화 텍스트 스트림 |
| 오류 로그 | AI 서비스 오류 및 연결 이슈 |
| 라이선스 상태 | 동시 통화 한도 및 사용량 |

---

## 15. 자주 묻는 질문 (FAQ)

**Q: 한국어와 영어가 섞인 통화(코드 스위칭)는 어떻게 처리하나요?**
A: Deepgram의 `language: 'multi'` 또는 `language: 'ko'`를 사용하세요. Nova-3 모델은 한국어+영어 혼용을 잘 처리합니다.

**Q: 통화 중 AI 음성을 중단시킬 수 있나요?**
A: OpenAI Realtime 어댑터를 사용하는 경우 서버 VAD가 자동으로 처리합니다. 카스케이드 파이프라인에서는 `gw.stopTtsInjection(linkedId)`를 호출하세요.

**Q: API 키 비용이 걱정됩니다.**
A: 비용 최적화 조합을 추천합니다:
- STT: Deepgram Nova-3 (분당 약 $0.0043)
- LLM: claude-haiku 또는 gpt-4o-mini (토큰당 가장 저렴)
- TTS: ElevenLabs Flash v2.5 또는 OpenAI tts-1

**Q: 녹음/전사 데이터를 저장하고 싶습니다.**
A: `onTranscript` 콜백에서 DB에 저장하면 됩니다. 단, 개인정보보호법 준수를 위해 동의 없이 저장하지 마세요.

**Q: 동시에 몇 통화까지 처리할 수 있나요?**
A: 서버 라이선스에 따라 다릅니다 (1 / 10 / 50 / 100 / 500+ 동시 통화). `http://your-gateway:8080/api/v1/license/status`에서 현재 한도를 확인할 수 있습니다.

**Q: 인터넷 없이 온프레미스로만 사용 가능한가요?**
A: DVGateway 서버 자체는 온프레미스로 설치 가능합니다. 단, AI 서비스(Deepgram, ElevenLabs 등)는 외부 API를 호출하므로 인터넷 연결이 필요합니다. 완전 폐쇄망 환경은 별도 문의하세요.

---

## 16. 문제 해결

### 연결 오류: `ECONNREFUSED http://localhost:8080`

DVGateway 서버가 실행 중인지 확인하세요:

```bash
# 서비스 상태 확인
systemctl status dvgateway

# 재시작
systemctl restart dvgateway

# 로그 확인
journalctl -u dvgateway -f
```

### STT가 인식을 못 함

1. Deepgram API 키가 올바른지 확인 (`dg_` 로 시작)
2. 언어 코드 확인 (`language: 'ko'`)
3. 대시보드(`http://your-server:8081`)에서 VU 미터로 오디오 수신 여부 확인

### TTS 음성이 통화에 재생되지 않음

1. `linkedId`가 정확한지 확인
2. `audioFilter` 방향 확인 (인바운드/아웃바운드)
3. DVGateway 로그에서 TTS 주입 오류 확인

### OpenAI Realtime 연결 오류

1. API 키에 Realtime 모델 접근 권한이 있는지 확인
2. `OpenAI-Beta: realtime=v1` 헤더가 설정되어 있는지 확인 (어댑터가 자동 처리)
3. 모델명이 정확한지 확인: `gpt-4o-realtime-preview`

### 지연 시간이 너무 김

지연 시간 단축 체크리스트:

- [ ] ElevenLabs: `model: 'eleven_flash_v2_5'`, `optimizeStreamingLatency: 4`
- [ ] Deepgram: `endpointingMs: 400` 이하로 설정
- [ ] LLM: `maxTokens` 를 256–512로 줄이기
- [ ] 가장 빠른 LLM 모델 사용: `claude-haiku-4-5-20251001` 또는 `gpt-4o-mini`
- [ ] 또는 OpenAI Realtime 어댑터로 전환 (단일 서비스, 최저 지연)

---

## 17. 원라인 서버 업데이트

```bash
# 대시보드 UI에서 업데이트 버튼 클릭
# 또는 터미널에서:
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

업데이트는 서비스 무중단으로 진행됩니다 (zero-downtime rolling update).

---

## 지원 및 문의

| 항목 | 연락처 |
|------|--------|
| 기술 지원 | GitHub Issues |
| 라이선스 문의 | OLSSOO Inc. 영업팀 |
| 버그 리포트 | GitHub Issues |

---

© 2026 OLSSOO Inc. All rights reserved.
DVGateway SDK는 [MIT 라이선스](../LICENSE)로 배포됩니다.
