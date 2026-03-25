# 연동 가능한 AI 서비스 전체 목록

## 6. 연동 가능한 AI 서비스 전체 목록

### 음성 인식 (STT — Speech to Text)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **Deepgram** | `DeepgramAdapter` | `nova-3` | 최고 정확도, 한국어 지원, 가장 빠른 스트리밍 |
| **whisper.cpp** ⭐로컬 | `WhisperCppAdapter` | `large-v3-turbo` | 완전 오프라인, 무료, GPU/CPU 모두 지원 |
| **Faster-Whisper** ⭐로컬 | `FasterWhisperAdapter` | `large-v3` | Python 고속 추론 (CTranslate2), 배치 지원 |
| **OpenAI Whisper** 로컬 | `WhisperLocalAdapter` | `large-v3` | Python 공식 라이브러리, 설치 간단 |
| **Qwen3-ASR** 로컬 | `QwenAudioAdapter` | `Qwen3-ASR-1.7B` | 52개 언어, 오픈소스 최고 성능 ASR (2026-01 출시) |

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
| **Qwen (Ollama)** ⭐로컬 | `OllamaAdapter` | `qwen3.5:9b` | 완전 무료, GPU 불필요 (CPU 가능), 멀티모달 |
| **vLLM 서버** 로컬 | `OpenAICompatAdapter` | `Qwen/Qwen3-8B` 등 | OpenAI 호환 API, 고성능 GPU 서버 |

### 실시간 음성-음성 직통 (Realtime Speech-to-Speech)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **OpenAI Realtime** | `OpenAIRealtimeAdapter` | `gpt-4o-realtime-preview` | STT+LLM+TTS 통합, 최저 지연 |
| **OpenAI Realtime Mini** | `OpenAIRealtimeAdapter` | `gpt-4o-mini-realtime-preview` | 비용 효율적, Audio 1.5 엔진 |

### 클라우드 STT 서비스 — 내장 게이트웨이 어댑터

게이트웨이에 내장된 클라우드 STT 어댑터입니다. SDK 없이 대시보드에서 바로 사용할 수 있습니다.

| 서비스 | 게이트웨이 어댑터 | 프로토콜 | API Key 형식 | 한국어 | 특징 |
|--------|-----------------|---------|-------------|--------|------|
| **Deepgram** | `deepgram` | WebSocket | 단일 API Key | ✅ `nova-3` | 최저 레이턴시, 화자 구분(diarization), 스트리밍 |
| **OpenAI Whisper** | `openai` | WebSocket | API Key (`sk-...`) | ✅ `gpt-4o-transcribe` | 높은 정확도, VAD 내장, Realtime API 기반 |
| **Google Cloud STT** | `google` | REST (청크) | 서비스 계정 JSON Key | ✅ `latest_long` | 서울 리전(`asia-northeast3`), 기업 안정성 |
| **Azure Speech** | `azure` | WebSocket | 구독 키 + 리전 | ✅ | 한국 리전, 실시간 스트리밍 |
| **Qwen-ASR (DashScope)** | `qwen` | WebSocket | DashScope API Key | ✅ `paraformer-realtime-v2` | 52개 언어, 중국 리전 최적 |

### 클라우드 TTS 서비스 — 내장 게이트웨이 어댑터

게이트웨이에 내장된 클라우드 TTS 어댑터입니다. 안내방송, 입장인사, AI 응답 음성 합성에 사용됩니다.

| 서비스 | 게이트웨이 어댑터 | API Key 형식 | 한국어 | 특징 |
|--------|-----------------|-------------|--------|------|
| **ElevenLabs** | `elevenlabs` | API Key | ✅ | 자연스러운 음성, 최저 지연(<75ms), 감정 표현 |
| **OpenAI TTS** | `openai` | API Key (`sk-...`) | ✅ | `tts-1` / `gpt-4o-mini-tts`, 안정적 |
| **Google Cloud TTS** | `google` | 서비스 계정 JSON Key | ✅ | Neural2 / Studio 음성, 서울 리전 |
| **Azure TTS** | `azure` | 구독 키 + 리전 | ✅ | 한국 리전, SSML 지원 |
| **Qwen-TTS (CosyVoice)** | `qwen` | DashScope API Key | ✅ | 음성 복제, 중국 리전 최적 |

### API Key 차이점 — Google Cloud vs Google Gemini

> **주의**: Google Cloud API Key와 Google Gemini (AI Studio) API Key는 **별개의 인증 체계**입니다.

| | Google Cloud Platform | Google AI Studio (Gemini) |
|---|---|---|
| **용도** | STT, TTS, Vertex AI | Gemini LLM, 멀티모달 |
| **API Key 형식** | 서비스 계정 JSON 파일 (`.json`) | 단순 API Key (`AIza...`) |
| **인증 방식** | OAuth2 / 서비스 계정 | API Key 헤더 |
| **엔드포인트** | `{region}-aiplatform.googleapis.com` | `generativelanguage.googleapis.com` |
| **한국 리전** | ✅ `asia-northeast3` (서울) | ❌ 리전 선택 불가 (US 기반) |
| **과금** | GCP 프로젝트 빌링 계정 | Google AI Studio 별도 |
| **게이트웨이 지원** | ✅ STT(`google`) + TTS(`google`) | ❌ (별도 어댑터 필요) |

게이트웨이의 `google` STT/TTS 어댑터는 **Google Cloud Platform** API를 사용합니다.
Gemini LLM을 사용하려면 SDK에서 OpenAI 호환 어댑터로 연동하거나 별도 커스텀 어댑터가 필요합니다.

### 한국 환경 — 용도별 추천 조합

#### 조합 1: 최저 레이턴시 (AI 음성 봇)

```
STT: Deepgram (nova-3)        — ~200ms, WebSocket 스트리밍
LLM: OpenAI (gpt-4o-mini)     — ~100ms, 저렴하고 빠름 (기본)
     Anthropic (haiku-4-5)    — ~80ms, 한국어 우수 (백업)
TTS: ElevenLabs (flash v2.5)  — ~75ms, 자연스러운 음성
────────────────────────────
총 레이턴시: ~375ms (목표 500ms 이하 ✅)
```

```typescript
// SDK 예시 — OpenAI 기본, Anthropic 백업
await gw.pipeline()
  .stt(new DeepgramAdapter({ model: 'nova-3', language: 'ko' }))
  .llm(new OpenAILlmAdapter({ model: 'gpt-4o-mini' }))
  .fallback(new AnthropicAdapter({ model: 'claude-haiku-4-5-20251001' }))
  .tts(new ElevenLabsAdapter({ model: 'eleven_flash_v2_5' }))
  .start(callId);
```

#### 조합 2: 기업 안정성 (한국 리전)

```
STT: Google Cloud STT v2    — 서울 리전, SLA 99.9%
LLM: Claude (sonnet-4-6)    — 고품질 응답
TTS: Google Cloud TTS Neural2 — 서울 리전, 안정적
────────────────────────────
장점: 한국 리전 데이터 주권, 기업 SLA 보장
```

#### 조합 3: 올인원 최저비용 (OpenAI)

```
Realtime API: gpt-4o-mini-realtime-preview
────────────────────────────
STT+LLM+TTS 단일 WebSocket 연결
장점: 연동 단순, 비용 효율적 ($0.60/1M input tokens)
단점: 한국어 음성 품질이 전용 TTS 대비 낮음
```

#### 조합 4: 완전 무료 (로컬 AI)

```
STT: whisper.cpp (large-v3-turbo) — GPU 불필요, 오프라인
LLM: Qwen3.5:9b (Ollama)         — CPU 가능, 한국어 지원
TTS: espeak-ng (내장)             — 무료, 품질 낮음
────────────────────────────
장점: API 비용 0원, 인터넷 불필요
단점: 음성 품질, GPU 없으면 레이턴시 높음
```

#### 조합 5: 컨퍼런스 회의록 (STT Only)

```
STT: OpenAI Whisper (gpt-4o-transcribe) — 높은 정확도
  또는 Deepgram (nova-3, diarize=true)  — 화자 구분 포함
────────────────────────────
게이트웨이 대시보드에서 STT 시작 → 자동 회의록 생성
화자별 실시간 자막 오버레이 (YouTube 라이브 스트리밍 지원)
```

---

