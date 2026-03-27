# 어댑터별 상세 설정

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

#### 모델 비교 (2026-03 기준)

| 모델 ID | 설명 | 지연 | 언어 | 요청당 글자 | 크레딧/자 | 용도 |
|---------|------|------|------|------------|----------|------|
| `eleven_flash_v2_5` | 최저 지연, 실시간 최적 **(기본값)** | ~75ms | 32개 | 40,000 | 0.5 | 실시간 대화, 챗봇, 음성 에이전트 |
| `eleven_turbo_v2_5` | 품질/속도 균형 | ~200ms | 32개 | 40,000 | 0.5 | 준실시간 응답 |
| `eleven_multilingual_v2` | 고품질 다국어 (humanVoice 기본) | ~300ms | 29개 | 40,000 | 1.0 | 자연스러운 한국어, 나레이션 |
| `eleven_v3` | **최신 플래그십** — 최고 표현력, Audio Tags | 높음 | **74개** | **5,000** | 1.0 | 감정 연기, 오디오북, 다자 대화 |

> **실시간 음성 에이전트**: `eleven_flash_v2_5` 권장 (최저 지연, WebSocket 스트리밍 지원)
> **최고 한국어 품질**: `eleven_multilingual_v2` 또는 `eleven_v3` 선택
> **감정 표현 필요**: `eleven_v3` + Audio Tags 사용

#### eleven_v3 주요 특징

- **Audio Tags**: 텍스트에 `[감정]` 태그를 삽입하여 음성 감정/행동 제어
  ```
  [whispers] 누군가 온 것 같아요. [pause] 조용히 하세요.
  [excited] 정말요? 축하합니다! [laughs]
  [sighs] 14시간째 일하고 있어요. [nervous] 이게 될까요?
  ```
- **지원 태그**: `[whispers]`, `[shouts]`, `[laughs]`, `[sighs]`, `[gasps]`, `[crying]`,
  `[excited]`, `[nervous]`, `[calm]`, `[pause]`, `[hesitates]`, `[cheerfully]`, `[deadpan]` 등
- **Text to Dialogue API**: 다자간 대화 생성 (화자 전환, 감정 변화, 끼어들기 자동 처리)
- **제한사항**: WebSocket 스트리밍 미지원, `optimize_streaming_latency` 미지원, 요청당 5,000자 제한

#### 설정 예시

```typescript
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// ── 실시간 음성 에이전트 (권장) ──────────────────────────────
const realtimeTts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',
  model:   'eleven_flash_v2_5',       // 실시간 최적 (~75ms)
  voiceId: 'XrExE9yKIg1WjnnlVkGX',   // Yuna (한국어 여성, 추천 1위)
});

// ── 고품질 한국어 (humanVoice 기본 활성) ─────────────────────
const naturalTts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',
  model:   'eleven_multilingual_v2',  // 자연스러운 한국어 억양
  voiceId: 't0jbNlBVZ17f02VDIeMI',   // 지영 / JiYoung (한국어 여성)
  stability:       0.3,               // 낮을수록 자연스러운 변화
  similarityBoost: 0.75,
  style:           0.6,               // 표현력 향상
});

// ── eleven_v3 감정 연기 ──────────────────────────────────────
const expressiveTts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',
  model:   'eleven_v3',               // 최고 표현력, Audio Tags 지원
  voiceId: 'XrExE9yKIg1WjnnlVkGX',   // Yuna
  humanVoice: false,                  // v3는 자체 감정 엔진 사용
});
// Audio Tags 사용 예시:
// await expressiveTts.synthesize('[cheerfully] 안녕하세요! [pause] 무엇을 도와드릴까요?');
```

**음성 품질 옵션:**

```typescript
const tts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',
  voiceId: 'YOUR_VOICE_ID',

  stability:               0.5,   // 안정성 (0.0–1.0, 높을수록 일관됨)
  similarityBoost:         0.75,  // 원본 음성 유사도 (0.0–1.0)
  style:                   0.0,   // 표현력 (0.0–1.0, 높으면 지연 증가)
  useSpeakerBoost:         true,  // 음성 선명도 향상

  // v2 모델 전용 (v3에서는 무시됨)
  optimizeStreamingLatency: 4,    // 0(품질 최대) ~ 4(지연 최소, 기본값)
  outputFormat: 'pcm_24000',      // 내부 포맷 (변경 불필요)
});
```

#### 한국어 네이티브 음성 — 인기순 추천

| 순위 | 음성 ID | 이름 | 성별 | 추천 용도 |
|:---:|---------|------|:----:|----------|
| 1 | `XrExE9yKIg1WjnnlVkGX` | **Yuna** | 여성 | 상담 에이전트, 안내 음성 (가장 자연스러운 한국어 발화) |
| 2 | `t0jbNlBVZ17f02VDIeMI` | **지영 / JiYoung** | 여성 | 고객 상담, 따뜻한 톤 (뉴스/나레이션에도 적합) |
| 3 | `ThT5KcBeYPX3keUQqHPh` | **Jina** | 여성 | 밝고 명확한 발음 (ARS, 정보 안내) |
| 4 | `pjJMvFj0JGWi3mogOkHH` | **Hyun Bin** | 남성 | 남성 에이전트 (안정적이고 신뢰감 있는 톤) |
| 5 | `Xb7hH8MSUJpSbSDYk0k2` | **Anna Kim** | 여성 | 차분한 톤 (교육, 설명 콘텐츠) |
| 6 | `zrHiDhphv9ZnVXBqCLjz` | **Jennie** | 여성 | 젊고 활기찬 톤 (마케팅, 프로모션) |
| 7 | `ZJCNdOEhQGMOIbMuhBME` | **Han Aim** | 남성 | 깊은 남성 음성 (브랜드 나레이션) |
| 8 | `ova4yY2jqnnUdGOmTGbx` | **KKC HQ** | 남성 | 스토리텔링, 유튜브 나레이션 |
| 9 | `Sita5M0jWFxPiECPABjR` | **jjeong** | 여성 | 캐주얼한 톤 (팟캐스트, 일상 대화) |

> **팁**: 더 자연스러운 한국어 음성을 원하면 [ElevenLabs Voice Library](https://elevenlabs.io/voice-library)에서
> "Korean" 필터 → 인기순 정렬로 검색하세요. 한국인 사용자가 만든 **Professional Voice Clone(PVC)**이
> 기본 제공 음성보다 품질이 뛰어납니다.

```typescript
import { ELEVENLABS_KOREAN_VOICES } from 'dvgateway-adapters';

// 내장 한국어 음성 사용 (인기순)
const tts = new ElevenLabsAdapter({
  apiKey: 'sk_xxxx',
  voiceId: ELEVENLABS_KOREAN_VOICES[0].id,  // Yuna (추천 1위)
});
```

**동적 음성 조회 & 클로닝:**

```typescript
// 사용 가능한 모든 음성 조회 (기본 + 클론 + 라이브러리)
const voices = await ElevenLabsAdapter.fetchVoices('sk_xxxx');

// 오디오 파일로 음성 복제
const cloned = await ElevenLabsAdapter.cloneVoice(
  'sk_xxxx', '내 목소리', audioData, 'sample.wav',
);
```

**REST API:**
```
GET  /api/v1/config/apikeys/voices/elevenlabs/fetch  — 음성 목록 조회
POST /api/v1/config/apikeys/voices/elevenlabs/clone  — 음성 복제 (multipart/form-data)
```

**추가 음성 찾기:**
ElevenLabs 콘솔(https://elevenlabs.io/voice-library)에서 "Korean"으로 검색하거나,
자신의 목소리를 클론하여 `voiceId`로 사용할 수 있습니다.

---

### Google Gemini TTS (음성 합성)

Google Gemini TTS는 Google Cloud Text-to-Speech API의 Gemini 모델을 사용합니다.
**Google AI Studio**에서 무료 API 키를 발급받아 바로 사용할 수 있으며, 한국어 음성 품질이 우수합니다.

> **API 키 발급**: [Google AI Studio](https://aistudio.google.com/apikey) → API 키 생성 (무료)

#### 모델 비교 (2026-03 기준)

| 모델 ID | 설명 | 지연 | 음성 수 | 언어 | 용도 |
|---------|------|------|--------|------|------|
| `gemini-2.5-flash-tts` | 저지연, 실시간 최적 **(기본값)** | 빠름 | 30개 | 24개+ | 실시간 대화, 음성 에이전트 |
| `gemini-2.5-pro-tts` | 최고 품질, 풍부한 운율 | 보통 | 30개 | 24개+ | 나레이션, 고품질 안내 |

#### 설정 예시

```typescript
import { GeminiTtsAdapter } from 'dvgateway-adapters/tts';

// ── 실시간 음성 에이전트 (권장) ──────────────────────────────
const tts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxxx',               // Google AI Studio API 키
  voice:  'Kore',                     // 한국어 여성 (기본값)
  model:  'gemini-2.5-flash-tts',    // 실시간 최적 (기본값)
  languageCode: 'ko-KR',             // 한국어 (기본값)
});

// ── 고품질 한국어 나레이션 ────────────────────────────────────
const hqTts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxxx',
  voice:  'Kore',
  model:  'gemini-2.5-pro-tts',      // 최고 품질
});

// ── 자연어 프롬프트로 스타일 제어 ─────────────────────────────
const styledTts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxxx',
  voice:  'Puck',                     // 남성 음성
  prompt: '따뜻하고 차분하게 말하세요. 문장 사이에 짧은 쉼을 두세요.',
});
```

```python
from dvgateway.adapters.tts import GeminiTtsAdapter

# ── 실시간 음성 에이전트 (권장) ──────────────────────────────
tts = GeminiTtsAdapter(
    api_key="AIza_xxxx",              # Google AI Studio API 키
    voice="Kore",                      # 한국어 여성 (기본값)
    model="gemini-2.5-flash-tts",     # 실시간 최적 (기본값)
    language="ko-KR",                  # 한국어 (기본값)
)

# ── 고품질 한국어 나레이션 ────────────────────────────────────
hq_tts = GeminiTtsAdapter(
    api_key="AIza_xxxx",
    voice="Kore",
    model="gemini-2.5-pro-tts",       # 최고 품질
)
```

#### 음성 추천 — 한국어

| 음성 | 성별 | 특징 | 추천 용도 |
|------|:----:|------|----------|
| **Kore** | 여성 | 자연스럽고 따뜻한 톤 **(기본값)** | 고객 상담, 안내 음성 |
| **Puck** | 남성 | 명확하고 친근한 톤 | 남성 에이전트, 정보 안내 |
| **Aoede** | 여성 | 멜로디컬하고 표현력 있음 | 나레이션, 스토리텔링 |
| **Charon** | 남성 | 깊고 권위 있는 톤 | 브랜드 나레이션 |
| **Leda** | 여성 | 부드럽고 차분한 톤 | 명상, ASMR, 안내 방송 |
| **Orus** | 남성 | 차분하고 절도 있는 톤 | 뉴스, 보고서 읽기 |
| **Zephyr** | 중성 | 가볍고 밝은 톤 | 캐주얼 대화 |
| **Schedar** | 남성 | 또렷하고 정확한 발음 | ARS, 정보 안내 |

> **전체 30개 음성**: Kore, Puck, Aoede, Charon, Fenrir, Leda, Orus, Zephyr,
> Achernar, Achird, Algenib, Algieba, Alnilam, Autonoe, Callirhoe, Despina,
> Enceladus, Erinome, Gacrux, Iapetus, Laomedeia, Pulcherrima, Rasalgethi,
> Sadachbia, Sadaltager, Schedar, Sulafar, Umbriel, Vindemiatrix, Zubenelgenubi

#### 자연어 프롬프트 (prompt)

TypeScript에서 `prompt` 옵션을 사용하면 자연어로 음성 스타일을 제어할 수 있습니다:

```typescript
const tts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxxx',
  prompt: '밝고 에너지 넘치는 톤으로, 약간 빠르게 말하세요.',
});

// 감정 표현 예시
await tts.synthesize('축하합니다! 주문이 완료되었습니다.');
```

프롬프트 예시:
- `"따뜻하고 차분하게 말하세요"` — 상담원
- `"밝고 에너지 넘치는 톤으로 말하세요"` — 프로모션
- `"천천히, 또박또박 발음하세요"` — ARS 안내
- `"속삭이듯 부드럽게 말하세요"` — ASMR/명상

#### ElevenLabs vs Gemini TTS 비교

| 항목 | ElevenLabs | Gemini TTS |
|------|-----------|------------|
| API 키 발급 | ElevenLabs 사이트 | Google AI Studio (무료) |
| 무료 크레딧 | 월 10,000자 (무료 플랜) | 무료 티어 포함 |
| 한국어 품질 | 매우 우수 (네이티브 음성) | 우수 (자연스러운 운율) |
| 실시간 지연 | ~75ms (flash v2.5) | 빠름 (flash-tts) |
| 음성 클로닝 | 지원 | 미지원 |
| 스타일 제어 | stability/style 파라미터 | 자연어 prompt |
| 스트리밍 | WebSocket 스트리밍 | REST (전체 응답) |

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

  // ── 고급 설정 (선택) ─────────────────────────────────────
  // topP: 0.9,                           // 핵 샘플링 (temperature와 동시 사용 불가)
  // stopSequences: ['###', '[END]'],      // 이 문자열이 등장하면 생성 중단
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
  //   'gpt-4o-realtime-preview'                     — 최고 품질 (기본값, 항상 최신)
  //   'gpt-4o-realtime-preview-2024-12-17'          — 고정 버전 (재현성 필요 시)
  //   'gpt-4o-mini-realtime-preview'                — 비용 절감형 (Audio 1.5)
  //   'gpt-4o-mini-realtime-preview-2024-12-17'     — 고정 버전 (미니)

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

### 로컬 STT — whisper.cpp (오프라인 무료)

**whisper.cpp**는 OpenAI Whisper 모델을 C++로 재구현한 초고속 로컬 STT 엔진입니다.
인터넷 없이 완전 오프라인 운영이 가능하며, CPU만으로도 실시간에 가까운 속도를 냅니다.

#### 1단계 — whisper.cpp 서버 설치 및 실행

```bash
# 소스 빌드 (Ubuntu/Debian)
sudo apt update && sudo apt install -y build-essential libopenblas-dev cmake git
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# GPU 지원 빌드 (CUDA — NVIDIA GPU가 있는 경우)
cmake -B build -DGGML_CUDA=ON
# CPU 전용 빌드
cmake -B build

cmake --build build --config Release -j$(nproc)

# 모델 다운로드 (large-v3-turbo 권장 — 속도·정확도 균형)
bash ./models/download-ggml-model.sh large-v3-turbo
# 또는 한국어 정확도 최고
bash ./models/download-ggml-model.sh large-v3

# HTTP 스트리밍 서버 실행 (포트 8178)
./build/bin/whisper-server \
  --model models/ggml-large-v3-turbo.bin \
  --host 0.0.0.0 \
  --port 8178 \
  --language ko \
  --threads 4 \
  --beam-size 1 \
  --no-timestamps
```

> **모델 용량**: `tiny`(75MB) ~ `large-v3`(3.1GB). 실시간 통화에는 `large-v3-turbo`(809MB) 권장.

#### 2단계 — Node.js 어댑터 설정

```typescript
import { WhisperCppAdapter } from 'dvgateway-adapters/stt';

const stt = new WhisperCppAdapter({
  // whisper.cpp HTTP 서버 주소 (같은 서버라면 localhost)
  serverUrl: 'http://localhost:8178',

  // ── 언어 설정 ───────────────────────────────────────────
  language: 'ko',       // 'ko' | 'en' | 'ja' | 'zh' | 'auto'

  // ── 발화 감지 ────────────────────────────────────────────
  // whisper.cpp는 VAD(Voice Activity Detection)를 내장 지원
  vadEnabled:      true,    // 자동 발화 감지 활성화
  vadThreshold:    0.6,     // 발화 감지 민감도 (0.0–1.0)
  silenceDurationMs: 600,   // 발화 종료 판단 침묵 시간

  // ── 추론 품질 ────────────────────────────────────────────
  beamSize:       1,        // 1=빠름, 5=정확 (실시간에는 1 권장)
  temperature:    0.0,      // 0.0=결정론적 (가장 안정적)
  noSpeechThreshold: 0.6,   // 무음 구간 필터링 임계값
});
```

#### 2단계 — Python 어댑터 설정

```python
from dvgateway.adapters.stt import WhisperCppAdapter

stt = WhisperCppAdapter(
    server_url="http://localhost:8178",  # whisper.cpp 서버 주소
    language="ko",
    vad_enabled=True,
    vad_threshold=0.6,
    silence_duration_ms=600,
    beam_size=1,
    temperature=0.0,
)
```

**모델별 성능 비교 (CPU 4코어 기준):**

| 모델 | 크기 | 실시간 배율 | 한국어 정확도 |
|------|------|------------|-------------|
| `tiny` | 75MB | ~32x | 낮음 |
| `base` | 142MB | ~16x | 보통 |
| `medium` | 769MB | ~6x | 좋음 |
| `large-v3-turbo` ★ | 809MB | ~8x | 매우 좋음 |
| `large-v3` | 3.1GB | ~2x | 최고 |

---

### 로컬 STT — Faster-Whisper (Python 고속 추론)

**Faster-Whisper**는 CTranslate2 엔진으로 OpenAI Whisper를 4–8배 빠르게 실행합니다.
DVGateway 서버와 같은 머신에서 Python 프로세스로 실행합니다.

#### 1단계 — Faster-Whisper 서비스 설치

```bash
# 가상환경 설정
python3 -m venv /opt/faster-whisper-svc
source /opt/faster-whisper-svc/bin/activate

# 패키지 설치
pip install faster-whisper

# GPU 사용 시 (NVIDIA CUDA 12.x)
pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12

# 간단한 스트리밍 서버 실행 (dvgateway-whisper-server 유틸리티)
pip install dvgateway-whisper-server
dvgateway-whisper-server \
  --model large-v3 \
  --device cuda \        # CPU 사용 시: --device cpu
  --compute-type float16 \  # CPU 사용 시: int8
  --port 8179 \
  --language ko
```

> `dvgateway-whisper-server`는 DVGateway 생태계에서 제공하는 Faster-Whisper 래퍼 서버입니다.
> 독립 실행 스크립트로도 사용 가능합니다:

```python
# whisper_server.py — 독립 실행 가능
from faster_whisper import WhisperModel
from fastapi import FastAPI, WebSocket
import asyncio, numpy as np, struct

app = FastAPI()
model = WhisperModel("large-v3", device="cpu", compute_type="int8")

@app.websocket("/ws/transcribe")
async def transcribe_ws(ws: WebSocket):
    await ws.accept()
    audio_buffer = bytearray()

    while True:
        data = await ws.receive_bytes()
        audio_buffer.extend(data)

        # 640바이트(20ms) 청크가 쌓이면 추론
        if len(audio_buffer) >= 16000 * 2:   # 1초 분량
            pcm = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
            audio_buffer.clear()

            segments, info = model.transcribe(
                pcm,
                language="ko",
                beam_size=1,
                vad_filter=True,
                vad_parameters={"threshold": 0.5, "min_silence_duration_ms": 500},
            )
            for seg in segments:
                await ws.send_json({"text": seg.text, "is_final": True})

# 실행: uvicorn whisper_server:app --host 0.0.0.0 --port 8179
```

#### 어댑터 설정

**Node.js:**

```typescript
import { FasterWhisperAdapter } from 'dvgateway-adapters/stt';

const stt = new FasterWhisperAdapter({
  serverUrl:         'ws://localhost:8179/ws/transcribe',
  language:          'ko',
  vadEnabled:        true,
  vadThreshold:      0.5,
  silenceDurationMs: 500,
});
```

**Python:**

```python
from dvgateway.adapters.stt import FasterWhisperAdapter

stt = FasterWhisperAdapter(
    server_url="ws://localhost:8179/ws/transcribe",
    language="ko",
    vad_enabled=True,
    vad_threshold=0.5,
    silence_duration_ms=500,
)
```

또는 **Python 인프로세스 모드** (같은 프로세스에서 직접 실행):

```python
from dvgateway.adapters.stt import FasterWhisperAdapter

# server_url 없이 model 지정 → 인프로세스 실행 (추가 서버 불필요)
stt = FasterWhisperAdapter(
    model="large-v3",
    device="cpu",           # "cuda" (GPU 사용 시)
    compute_type="int8",    # CPU: "int8", GPU: "float16"
    language="ko",
    vad_enabled=True,
    vad_threshold=0.5,
    silence_duration_ms=500,
    beam_size=1,
    num_workers=2,          # 병렬 추론 워커 수
)
```

---

### 로컬 STT — OpenAI Whisper (Python 공식)

공식 OpenAI Whisper Python 라이브러리를 로컬에서 실행합니다.
Faster-Whisper보다 느리지만 설치가 가장 간단합니다.

```bash
# 설치
pip install openai-whisper

# ffmpeg 필요 (오디오 포맷 변환)
sudo apt install -y ffmpeg   # Ubuntu/Debian
# brew install ffmpeg        # macOS
```

**Python 인프로세스 어댑터:**

```python
from dvgateway.adapters.stt import WhisperLocalAdapter

stt = WhisperLocalAdapter(
    model="large-v3",       # "tiny" | "base" | "small" | "medium" | "large-v3"
    device="cpu",           # "cpu" | "cuda" | "mps" (Apple Silicon)
    language="ko",

    # 발화 감지 — silero-vad 사용 (pip install silero-vad)
    vad_enabled=True,
    vad_threshold=0.5,

    # 추론 옵션
    temperature=0.0,        # 0.0 = 결정론적 (가장 안정적)
    beam_size=1,            # 실시간에는 1 권장
    fp16=False,             # CPU에서는 False, GPU에서는 True
)
```

> **주의**: OpenAI Whisper는 스트리밍이 아닌 파일 단위 추론이 기본입니다.
> DVGateway 어댑터는 내부적으로 20ms 오디오 청크를 버퍼링하여 VAD 기반 세그먼트로 분할합니다.

---

### 로컬 LLM — Qwen (Ollama 경유)

**Qwen**은 Alibaba Cloud의 오픈소스 LLM으로, 한국어 성능이 우수합니다.
**Ollama**를 통해 GPU 없이 CPU만으로도 실행 가능합니다.

#### 1단계 — Ollama 설치 및 Qwen 모델 다운로드

```bash
# Ollama 설치 (Linux/macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Qwen3.5 모델 다운로드 (2026-03 최신 — 멀티모달, 한국어 최고 성능)
ollama pull qwen3.5:9b       # 9B 파라미터 (RAM 8GB 이상 권장) ★ 권장
ollama pull qwen3.5:4b       # 4B 경량 (RAM 4GB 이상)
ollama pull qwen3:8b         # 안정화된 Qwen3 이전 버전

# 실행 확인
ollama run qwen3:8b "안녕하세요, 잘 작동하나요?"

# Ollama 서버는 기본적으로 http://localhost:11434 에서 실행됩니다
```

#### 2단계 — 어댑터 설정

**Node.js:**

```typescript
import { OllamaAdapter } from 'dvgateway-adapters/llm';

const llm = new OllamaAdapter({
  baseUrl: 'http://localhost:11434',  // Ollama 서버 주소

  // ── 모델 선택 ────────────────────────────────────────────
  model: 'qwen3.5:9b',
  // 옵션:
  //   'qwen3.5:9b'      — 멀티모달, 한국어 최고 품질 (2026-03 최신) ★
  //   'qwen3.5:4b'      — RAM 4GB로 실행 가능한 경량형
  //   'qwen3:8b'        — 안정성 검증된 이전 세대
  //   'gemma3:12b'      — Google Gemma 3 대안
  //   'llama3.3:8b'     — Meta Llama 3.3 대안

  // ── 대화 설정 ────────────────────────────────────────────
  systemPrompt: '당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요.',
  maxTokens:    512,
  temperature:  0.7,

  // ── 스트리밍 ─────────────────────────────────────────────
  stream: true,   // 토큰 스트리밍 활성화 (지연 최소화)

  // ── Qwen3 특화 옵션 ──────────────────────────────────────
  options: {
    think: false,     // 사고 과정(thinking) 비활성화 → 빠른 응답
    num_ctx: 4096,    // 컨텍스트 윈도우 크기
    num_predict: 200, // 최대 생성 토큰 수
    top_p: 0.9,
    repeat_penalty: 1.1,
  },
});
```

**Python:**

```python
from dvgateway.adapters.llm import OllamaAdapter

llm = OllamaAdapter(
    base_url="http://localhost:11434",
    model="qwen3.5:9b",
    system_prompt="당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요.",
    max_tokens=512,
    temperature=0.7,
    stream=True,
    options={
        "think": False,       # Qwen3 사고 과정 비활성화
        "num_ctx": 4096,
        "num_predict": 200,
        "top_p": 0.9,
        "repeat_penalty": 1.1,
    },
)
```

**Qwen 모델 선택 가이드 (2026-03 기준):**

| 모델 | RAM 요구 | 응답 속도 | 한국어 | 특징 |
|------|---------|---------|--------|------|
| `qwen3.5:4b` | 4GB | ★★★★★ | ★★★★ | 저사양 서버, 멀티모달 경량 (2026-03 최신) |
| `qwen3.5:9b` ★ | 8GB | ★★★★ | ★★★★★ | **권장**, 멀티모달, 고품질 한국어 (2026-03 최신) |
| `qwen3:8b` | 8GB | ★★★★ | ★★★★★ | 안정성 검증된 Qwen3 |
| `qwen3:14b` | 16GB | ★★★ | ★★★★★ | 복잡한 추론 |

> **Qwen3 `think` 옵션**: Qwen3는 기본적으로 "사고 과정"을 생성합니다. 실시간 음성 봇에서는 `think: false`로 비활성화하여 응답 속도를 높이세요.

---

### 로컬 LLM — vLLM 서버 연동

**vLLM**은 고성능 GPU 서버에서 OpenAI 호환 API로 LLM을 서빙합니다.
DVGateway의 `OpenAICompatAdapter`로 바로 연결됩니다.

#### 1단계 — vLLM 서버 설치 및 실행

```bash
# vLLM 설치 (CUDA 12.x + Python 3.10+)
pip install vllm

# Qwen3-8B 모델 서버 실행 (Hugging Face에서 자동 다운로드)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-8B \
  --port 8000 \
  --served-model-name qwen3-8b \
  --max-model-len 4096 \
  --tensor-parallel-size 1 \   # GPU 수
  --dtype auto \
  --trust-remote-code

# 확인
curl http://localhost:8000/v1/models
```

#### 2단계 — 어댑터 설정

**Node.js:**

```typescript
import { OpenAICompatAdapter } from 'dvgateway-adapters/llm';

const llm = new OpenAICompatAdapter({
  // vLLM 서버는 OpenAI API와 완전 호환
  baseUrl: 'http://localhost:8000/v1',
  apiKey:  'not-needed',   // vLLM은 키 검증 없음 (로컬)

  model: 'qwen3-8b',       // --served-model-name 으로 지정한 이름
  systemPrompt: '친절한 한국어 AI 상담원입니다. 짧게 답변하세요.',
  maxTokens:    512,
  temperature:  0.7,
  stream:       true,

  // Qwen3 사고 과정 비활성화 (extra_body)
  extraBody: {
    chat_template_kwargs: { enable_thinking: false },
  },
});
```

**Python:**

```python
from dvgateway.adapters.llm import OpenAICompatAdapter

llm = OpenAICompatAdapter(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",
    model="qwen3-8b",
    system_prompt="친절한 한국어 AI 상담원입니다. 짧게 답변하세요.",
    max_tokens=512,
    temperature=0.7,
    stream=True,
    extra_body={
        "chat_template_kwargs": {"enable_thinking": False}
    },
)
```

> **vLLM 대안**: SGLang, LMDeploy, llama.cpp server 등도 OpenAI 호환 API를 제공하므로 `OpenAICompatAdapter`로 동일하게 연결됩니다.

**완전 로컬(오프라인) 파이프라인 예시:**

```typescript
// 모든 컴포넌트를 로컬에서 실행 — 인터넷 불필요
await gw.pipeline()
  .stt(new WhisperCppAdapter({
    serverUrl: 'http://localhost:8178',
    language:  'ko',
    vadEnabled: true,
  }))
  .llm(new OllamaAdapter({
    baseUrl:     'http://localhost:11434',
    model:       'qwen3:8b',
    systemPrompt: '친절한 한국어 AI 상담원입니다.',
    options:     { think: false },
  }))
  .tts(new ElevenLabsAdapter({    // TTS는 현재 로컬 오픈소스 품질이 제한적이므로 유료 권장
    apiKey:  process.env.ELEVENLABS_API_KEY!,
    model:   'eleven_flash_v2_5',
    voiceId: 'YOUR_VOICE_ID',
  }))
  .start();
```

---

