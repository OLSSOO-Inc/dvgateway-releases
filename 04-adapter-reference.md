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

#### 보정 전 원문 확인 (`rawText` · SDK 1.9.3+ · 게이트웨이 1.4.15.223+)

**무엇을 해결하나** — 사용자가 *"내가 말한 것과 다르게 인식됐다"* 고 할 때,
**STT 가 잘못 들은 것**인지 **보정기(smart format)가 바꿔 놓은 것**인지 원문과 보정본을
비교해 구분할 수 있습니다.

`smartFormat`/`punctuate` 가 켜져 있으면 `result.text` 는 **보정본**입니다. 보정 전 원문은
`result.rawText`(단어 단위는 `words[].rawWord`)로 **같은 이벤트에 함께** 옵니다.

⭐ **추가 호출·추가 과금이 0입니다.** Deepgram 이 원문(`words[].word`)과
보정본(`words[].punctuated_word`)을 **한 응답에 함께** 보내므로 그대로 전달합니다.
그래서 **기본값이 켜짐**입니다.

```ts
pipeline.on('transcript', (result) => {
  if (!result.isFinal) return;
  console.log('보정본:', result.text);
  if (result.rawText) console.log('원문  :', result.rawText);  // 다를 때만 옵니다
});
```

```
보정본: 네, 삼백원입니다.
원문  : 네 삼백원입니다
```

**끄는 방법 (3개 층 · 기본은 모두 켜짐)**

발화 내용이 늘 민감한 도메인이거나 페이로드를 줄이고 싶으면 끌 수 있습니다. **끄면 원문을
만들지도 않습니다**(만들고 버리는 것이 아니라 재구성 자체를 건너뜁니다).

| 층 | 방법 | 적용 범위 | 반영 |
|---|---|---|---|
| 게이트웨이 전체 | 운영사에 요청 | 게이트웨이 전체 | 운영사 적용 시 |
| 테넌트별 | `POST /api/v1/config/apikeys` → 해당 provider `{"rawText": false}` | 그 테넌트 | hot-reload |
| SDK 어댑터 | `new DeepgramAdapter({ rawTranscript: false })` | 그 앱 | 즉시 |

```ts
// SDK 에서 끄기
const stt = new DeepgramAdapter({
  apiKey: process.env.DEEPGRAM_API_KEY!,
  model: 'nova-3',
  language: 'ko',
  rawTranscript: false,   // 기본 true — 원문을 만들지 않습니다
});
```

```python
# Python
stt = DeepgramAdapter(
    api_key=os.environ["DEEPGRAM_API_KEY"],
    model="nova-3",
    language="ko",
    raw_transcript=False,   # 기본 True
)
```

⚠️ **테넌트 설정은 tri-state 입니다** — `rawText` 를 **보내지 않으면**(미지정) 게이트웨이
전체 설정을 따르고, `false` 를 **명시하면** 전체 설정이 켜져 있어도 그 테넌트만
꺼집니다. 반대로 전체 설정이 꺼져 있어도 `true` 로 특정 테넌트만 켤 수 있습니다.

⚠️ **SDK 옵션과 게이트웨이 설정은 서로 독립입니다.** SDK 어댑터를 직접 쓰는 경로는
`rawTranscript` 가, 게이트웨이 `stt:result` 구독 경로는 게이트웨이·테넌트 설정이 각각 결정합니다 —
한쪽을 껐다고 다른 쪽이 꺼지지 않습니다.

**주의사항**

⚠️ **`rawText` 로 `text` 를 대체하지 마세요.** 단어를 공백으로 이어 붙인 **근사값**이라
띄어쓰기·숫자 표기가 다릅니다(한국어는 **띄어쓰기 자체가 보정 대상**입니다). 표시·요약·저장은 계속
`text` 를 쓰고, `rawText` 는 *"STT 가 실제로 무엇을 들었는가"* 를 봐야 하는 **진단**에
씁니다.

⚠️ **켜져 있어도 안 오는 것이 정상입니다.** 보정이 없었으면
(`smartFormat:false`+`punctuate:false`) 원문과 보정본이 같으므로 필드를 **보내지 않습니다**
— 같은 값을 한 벌 더 보내면 낭비이고, *"원문이 따로 있다"* 는 잘못된 신호가 됩니다. 부재는
오류가 아니므로 항상 `if (result.rawText)` 로 확인하세요.

⚠️ **통화 요약(배치) 결과에는 제공되지 않습니다.** `rawText` 는 **실시간 스트리밍에서만** 제공됩니다.

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
  //   'gpt-realtime-2'                              — 신모델 (GPT-5급 추론, 2026-05)
  //   'gpt-realtime-translate'                      — 실시간 통역 (70+ → 13 언어)
  //   'gpt-realtime-1.5'                            — 이전 세대
  //   'gpt-4o-realtime-preview'                     — 레거시 (현 SDK 기본값)
  //   'gpt-4o-realtime-preview-2024-12-17'          — 레거시 고정 버전
  //   'gpt-4o-mini-realtime-preview'                — 레거시 비용 절감형 (Audio 1.5)
  //   'gpt-4o-mini-realtime-preview-2024-12-17'     — 레거시 고정 미니

  // ── 입력 transcription 모델 (선택) ──────────────────────────
  // inputTranscriptionModel: 'whisper-1',
  // 옵션:
  //   'whisper-1'              — 기본값
  //   'gpt-4o-transcribe'      — 다국어 정확도 향상
  //   'gpt-4o-mini-transcribe' — 저비용
  //   'gpt-realtime-whisper'   — 스트리밍 라이브 transcription (2026-05)

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

### 로컬(오프라인) LLM — Ollama · vLLM · LM Studio

SDK 에는 로컬 LLM 전용 어댑터가 따로 없습니다. 대신 **`OpenAILlmAdapter` 의 `baseUrl` / `base_url`**(SDK 1.9.2+)로 **OpenAI 호환 API** 를 제공하는 로컬 서버를 가리키면 됩니다. Ollama · vLLM · LM Studio · SGLang · llama.cpp server 가 모두 이 방식으로 연결됩니다.

#### 1단계 — 로컬 LLM 서버 실행

```bash
# (A) Ollama — GPU 없이 CPU 로도 실행 가능
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b
# OpenAI 호환 주소: http://localhost:11434/v1

# (B) vLLM — 고성능 GPU 서버
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-8B --served-model-name qwen3-8b --port 8000
# OpenAI 호환 주소: http://localhost:8000/v1
curl http://localhost:8000/v1/models   # 확인
```

#### 2단계 — 어댑터 설정

**Node.js:**

```typescript
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';

const llm = new OpenAILlmAdapter({
  baseUrl: 'http://localhost:11434/v1',  // Ollama (vLLM 이면 'http://localhost:8000/v1')
  apiKey:  'local',                      // 로컬 서버는 키를 검사하지 않지만 빈 값은 넣지 마세요
  model:   'qwen3:8b',                   // Ollama 모델 이름 / vLLM 은 --served-model-name 값
  systemPrompt: '당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요. /no_think',
  maxTokens:    512,
  temperature:  0.7,
});
```

**Python:**

```python
from dvgateway.adapters.llm import OpenAILlmAdapter

llm = OpenAILlmAdapter(
    base_url="http://localhost:11434/v1",   # vLLM 이면 "http://localhost:8000/v1"
    api_key="local",
    model="qwen3:8b",
    system_prompt="당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요. /no_think",
    max_tokens=512,
    temperature=0.7,
)
```

> **Qwen3 사고 과정 끄기**: Qwen3 는 기본적으로 "사고 과정"을 먼저 생성해 응답이 늦어집니다. 어댑터에는 서버별 추가 옵션(Ollama `options`, vLLM `extra_body` 등)을 넘기는 자리가 없으므로, 위 예시처럼 시스템 프롬프트 끝에 `/no_think` 를 붙이거나 사고 과정이 없는 모델을 고르세요.

> `baseUrl` 이 비어 있으면 공식 OpenAI 엔드포인트로 갑니다. SDK 1.9.1 이하는 `baseUrl` 을 무시하므로 로컬 서버를 쓰려면 1.9.2 이상으로 올리세요.

---

### 로컬(오프라인) STT — 직접 어댑터 구현

SDK 에는 **로컬 STT 어댑터(whisper.cpp · Faster-Whisper 등)가 내장되어 있지 않습니다.** 내장 STT 어댑터는 클라우드용(`DeepgramAdapter` · `GoogleChirp3Adapter` · `OpenAISttAdapter`)뿐입니다. 로컬 엔진을 쓰려면 `SttAdapter` 인터페이스를 직접 구현해 파이프라인에 넣습니다.

`SttAdapter` 가 구현할 것은 세 가지입니다:

| 메서드 (TS / Python) | 하는 일 |
|------|------|
| `startStream(linkedId, audioStream)` / `start_stream(linked_id, audio_stream)` | 통화 오디오(`AudioChunk` — 16kHz, `samples` 는 -1.0~1.0 실수)를 읽어 인식 엔진에 보냅니다 |
| `onTranscript(handler)` / `on_transcript(handler)` | 인식 결과(`TranscriptResult`)를 받을 핸들러를 등록합니다 |
| `stop()` / `stop()` | 정리합니다 |

아래는 **골격 예시**입니다. 오디오를 일정 길이씩 모아 로컬 엔진에 넘기는 가장 단순한 형태이고, `transcribeLocally()` 는 여러분이 쓰는 엔진(예: whisper.cpp 서버의 HTTP 추론 API)에 맞게 구현해야 합니다. 실서비스에서는 고정 길이 대신 VAD(무음 감지)로 발화 단위를 끊는 것이 좋습니다.

```typescript
import type { SttAdapter, AudioChunk, TranscriptResult } from 'dvgateway-sdk';

// 여러분의 로컬 엔진 호출 — 16kHz 16-bit mono PCM 을 받아 텍스트를 돌려주도록 구현하세요
declare function transcribeLocally(pcm16: Buffer): Promise<string>;

export class LocalWhisperAdapter implements SttAdapter {
  private handler: ((r: TranscriptResult) => void) | null = null;
  private stopped = false;

  onTranscript(handler: (r: TranscriptResult) => void): void {
    this.handler = handler;
  }

  async startStream(linkedId: string, audioStream: AsyncIterable<AudioChunk>): Promise<void> {
    const SEGMENT_MS = 3000;          // 3초씩 모아 인식 (예시 값)
    let frames: Buffer[] = [];
    let ms = 0;
    for await (const chunk of audioStream) {
      if (this.stopped) break;
      const pcm = Buffer.alloc(chunk.samples.length * 2);
      chunk.samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
      frames.push(pcm);
      ms += chunk.durationMs;
      if (ms >= SEGMENT_MS) {
        const text = await transcribeLocally(Buffer.concat(frames));
        frames = [];
        ms = 0;
        if (text.trim()) this.handler?.({ linkedId, text, isFinal: true, timestampMs: Date.now() });
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

// 사용 — 내장 어댑터와 똑같이 파이프라인에 넣습니다
await gw.pipeline()
  .stt(new LocalWhisperAdapter())
  .llm(llm)                // 위의 로컬 LLM
  .tts(tts)
  .start();
```

```python
from dvgateway.types import SttAdapter, AudioChunk, TranscriptResult

async def transcribe_locally(pcm16: bytes) -> str:
    ...  # 여러분의 로컬 엔진 호출 (16kHz 16-bit mono PCM → 텍스트)

class LocalWhisperAdapter(SttAdapter):
    def __init__(self) -> None:
        self._handler = None
        self._stopped = False

    def on_transcript(self, handler) -> None:
        self._handler = handler

    async def start_stream(self, linked_id: str, audio_stream) -> None:
        segment_ms, frames, ms = 3000, bytearray(), 0.0
        async for chunk in audio_stream:          # chunk: AudioChunk
            if self._stopped:
                break
            for s in chunk.samples:
                frames += int(max(-1.0, min(1.0, s)) * 32767).to_bytes(2, "little", signed=True)
            ms += chunk.duration_ms
            if ms >= segment_ms:
                text = await transcribe_locally(bytes(frames))
                frames, ms = bytearray(), 0.0
                if text.strip() and self._handler:
                    self._handler(TranscriptResult(linked_id=linked_id, text=text, is_final=True))

    async def stop(self) -> None:
        self._stopped = True
```

> TTS 는 로컬 오픈소스 품질이 아직 제한적이라, 완전 오프라인이 꼭 필요한 경우가 아니면 클라우드 TTS 어댑터를 권장합니다.

---

