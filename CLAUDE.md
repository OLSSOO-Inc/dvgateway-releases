# CLAUDE.md — DVGateway SDK 사용자 가이드

이 파일은 AI 코딩 어시스턴트(Claude, Copilot 등)가 DVGateway SDK를 사용하는 프로젝트에서 작업할 때 참조하는 가이드입니다.

---

## SDK 개요

**DVGateway SDK**는 Dynamic VoIP PBX의 실시간 통화를 AI 파이프라인(STT·LLM·TTS)에 연결하는 라이브러리입니다.

| 언어 | 패키지 | 설치 |
|------|--------|------|
| TypeScript | `dvgateway-sdk` + `dvgateway-adapters` | `npm install dvgateway-sdk dvgateway-adapters` |
| Python | `dvgateway-python` | `pip install dvgateway-python` |

### 버전 호환성 및 알려진 이슈

| 버전 | 상태 | 비고 |
|------|------|------|
| `1.3.5` | ✅ 안정 | 권장 안정 버전 (마지막으로 검증된 릴리즈) |
| `1.3.6` | ⚠️ | 중간 릴리즈 |
| `1.3.7` | ❌ 버그 | `OpenAIRealtimeAdapter` 오디오 입력 타입 불일치 — S2S 세션에서 오디오가 조용히 끊김 |
| `1.3.8+` | ✅ 수정 | v1.3.7의 audio_in 타입 불일치 및 background task 사일런트 실패 수정 |

**v1.3.7 버그 상세:**
- `OpenAIRealtimeAdapter._pipe_audio_in()`이 `chunk.samples` (AudioChunk)를 기대하지만, 실제로는 `bytes`가 전달되는 경우가 있어 `AttributeError`로 background task가 사일런트 종료됨
- `on_error` 콜백으로 예외가 전파되지 않아 진단이 어려움

**워크어라운드 (v1.3.8 릴리즈 전):**
```bash
# Python: 이전 안정 버전 고정
pip install dvgateway-python==1.3.5
```

v1.3.8부터는 `_pipe_audio_in`이 `bytes` / `bytearray` / `memoryview` / `AudioChunk`를 모두 받아들이며, task 예외가 `on_error` 핸들러 또는 stderr로 표면화됩니다.

---

## 클라이언트 초기화

### TypeScript
```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY']! },
});
```

### Python
```python
from dvgateway import DVGatewayClient
gw = DVGatewayClient(
    base_url="http://localhost:8080",
    auth={"type": "apiKey", "api_key": "dvgw_xxx"},
)
```

---

## AI 음성 파이프라인 (STT → LLM → TTS)

```python
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import GeminiTtsAdapter

stt = DeepgramAdapter(api_key="dg_xxx", language="ko", model="nova-3")
llm = AnthropicAdapter(api_key="sk-ant-xxx", model="claude-sonnet-4-6",
    system_prompt="친절한 AI 상담원. 1-2문장으로 답변.")
tts = GeminiTtsAdapter(api_key="AIza_xxx")

await gw.pipeline().stt(stt).llm(llm).tts(tts).start()
```

---

## 전체 SDK 메서드 레퍼런스

### 통화 제어
| TypeScript | Python | 설명 |
|------------|--------|------|
| `hangup(linkedId)` | `hangup(linked_id)` | 통화 종료 |
| `redirect(linkedId, dest)` | `redirect(linked_id, dest)` | 통화 전환 |

### PBX 관리
| TypeScript | Python | 설명 |
|------------|--------|------|
| `applyChanges()` | `apply_changes()` | PBX 설정 재적용 |
| `clickToCall({caller,callee,...})` | `click_to_call(caller,callee,...)` | 클릭투콜 |

### 착신전환
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getDiversions(ext, tenantId?)` | `get_diversions(ext, tenant_id)` | 착신전환 조회 |
| `setDiversion(ext, type, params)` | `set_diversion(ext, cf_type, ...)` | 착신전환 설정 |
| `deleteDiversion(ext, type)` | `delete_diversion(ext, cf_type)` | 착신전환 해제 |

착신전환 타입: `CFI` (즉시), `CFB` (통화중), `CFN` (부재중), `CFU` (미연결)

### 발신자표시
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getCallerID(ext)` | `get_caller_id(ext)` | 발신자표시 조회 |
| `setCallerID(ext, {name,number,applyChanges})` | `set_caller_id(ext, name, number, apply_changes)` | 발신자표시 변경 |

> `applyChanges: true` → DB 변경 + PBX 재적용을 한번에 처리

### Early Media (응답 전 안내음)
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getEarlyMedia(ext, tenantId?)` | `get_early_media(ext, tenant_id)` | Early Media 설정 조회 |
| `setEarlyMedia(ext, {enabled,audioUrl,tts})` | `set_early_media(ext, enabled, audio_url, tts)` | Early Media 설정/변경 (URL 또는 TTS) |

두 가지 음원 모드 (택일):
- **`audioUrl`**: 외부 URL 자동 다운로드 + ffmpeg WAV 변환 (8kHz mono PCM)
- **`tts`**: 클라우드 TTS로 합성 — 대시보드 **프로바이더 API 키** 탭의 테넌트별 키 자동 사용

```typescript
// TypeScript — TTS로 Early Media 설정
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  tts: {
    text: '안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.',
    provider: 'elevenlabs',  // optional, 미지정 시 대시보드 primary 사용
    voice: '9BWtsMINqrJLrRacOk9x',  // optional
  },
}, 'tenant-id');
```

```python
# Python — TTS로 Early Media 설정
await gw.set_early_media("07045144801",
    enabled="yes",
    tts={
        "text": "안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.",
        "provider": "elevenlabs",  # optional
    },
    tenant_id="tenant-id")
```

> 저장 경로 (URL/TTS 동일): `/var/spool/asterisk/{tenantId}/pa/{extension}/pamsg.wav`
> TTS 메타데이터(text/provider/voice)는 AstDB에 저장되어 GET 응답에 포함됨

### 캠페인 (예약/동보/주기 발신)
| TypeScript | Python | 설명 |
|------------|--------|------|
| `createCampaign(campaign)` | `create_campaign(campaign)` | 캠페인 생성 |
| `listCampaigns()` | `list_campaigns()` | 캠페인 목록 |
| `getCampaign(id)` | `get_campaign(id)` | 캠페인 상세 |
| `updateCampaign(id, updates)` | `update_campaign(id, updates)` | 캠페인 수정 |
| `deleteCampaign(id)` | `delete_campaign(id)` | 캠페인 삭제 |
| `startCampaign(id)` | `start_campaign(id)` | 캠페인 시작 |
| `pauseCampaign(id)` | `pause_campaign(id)` | 일시정지 |
| `resumeCampaign(id)` | `resume_campaign(id)` | 재개 |
| `cancelCampaign(id)` | `cancel_campaign(id)` | 취소 |
| `getCampaignResults(id)` | `get_campaign_results(id)` | 결과 조회 |

### 오디오/TTS
| TypeScript | Python | 설명 |
|------------|--------|------|
| `injectTts(linkedId, audio)` | `inject_tts(linked_id, audio)` | TTS 오디오 주입 |
| `say(linkedId, text, tts)` | `say(linked_id, text, tts)` | 텍스트→음성 재생 |
| `broadcastTts(confId, audio)` | `broadcast_tts(conf_id, audio)` | 회의 전체 방송 |

### 이벤트/세션
| TypeScript | Python | 설명 |
|------------|--------|------|
| `onCallEvent(handler)` | `on_call_event(handler)` | 통화 이벤트 구독 |
| `listSessions()` | `list_sessions()` | 활성 세션 목록 |

---

## 세션 필드 (call:new 이벤트)

| 필드 | 설명 |
|------|------|
| `linkedId` / `linked_id` | 통화 고유 ID |
| `caller` | 발신자 번호 |
| `callerName` / `caller_name` | 발신자 이름 |
| `callee` | 착신자 번호 |
| `did` | DID 번호 |
| `tenantId` / `tenant_id` | 멀티테넌트 ID |
| `serverId` / `server_id` | 게이트웨이 서버 ID |
| `customValue1~3` / `custom_value_1~3` | 커스텀 변수 (다이얼플랜에서 전달) |
| `streamUrl` / `stream_url` | 오디오 WebSocket URL |

---

## 캠페인 이벤트 타입

callinfo WebSocket으로 실시간 수신:

| 이벤트 | 설명 |
|--------|------|
| `campaign:started` | 캠페인 시작 |
| `call:preparing` | 발신 준비 |
| `call:dialing` | 발신 요청 |
| `call:connected` | 발신 성공 |
| `call:failed` | 발신 실패 |
| `call:retry` | 재시도 대기 |
| `campaign:completed` | 캠페인 완료 |

---

## AI 어댑터

### STT (음성→텍스트)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `DeepgramAdapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | Deepgram Nova-3 (한국어 최적) |
| `GoogleChirp3Adapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | Google Chirp 3 (V2 API) |
| `OpenAISttAdapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | OpenAI Realtime Transcription (gpt-4o-transcribe) |

#### DeepgramAdapter 옵션

```typescript
// TypeScript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
const stt = new DeepgramAdapter({
  apiKey: 'dg_xxx',           // 필수
  language: 'ko',             // 기본: "ko"
  model: 'nova-3',            // nova-3, nova-3-medical, nova-3-phonecall, enhanced, base
  diarize: false,             // 화자 구분
  vadEnabled: true,           // 음성 활동 감지
  endpointingMs: 300,         // 발화 경계 감지 (ms)
  utteranceEndMs: 800,        // 발화 종료 감지 (ms)
  interimResults: true,       // 중간 결과
  smartFormat: true,          // 숫자/날짜 자동 포맷
  punctuate: true,            // 구두점
  keywords: ['DVGateway'],    // 키워드 부스팅
  profanityFilter: false,     // 비속어 필터
  sentiment: false,           // 감정 분석 (Nova-3)
});
```

```python
# Python
from dvgateway.adapters.stt import DeepgramAdapter
stt = DeepgramAdapter(
    api_key="dg_xxx",
    language="ko",
    model="nova-3",
    diarize=False,
    endpointing_ms=500,
    utterance_end_ms=1000,
    interim_results=True,
    smart_format=True,
    keywords=["DVGateway"],
    punctuate=True,
    profanity_filter=False,
    sentiment=False,
)
```

#### GoogleChirp3Adapter 옵션

```typescript
// TypeScript
import { GoogleChirp3Adapter } from 'dvgateway-adapters/stt';
const stt = new GoogleChirp3Adapter({
  apiKey: 'project_id:api_key',  // 필수 (V2: "project_id:key", V1: "key")
  language: 'ko-KR',             // 기본: "ko-KR"
  model: 'chirp_3',              // 기본: "chirp_3"
  punctuate: true,               // 구두점
});
```

```python
# Python
from dvgateway.adapters.stt import GoogleChirp3Adapter
stt = GoogleChirp3Adapter(
    api_key="project_id:api_key",
    language="ko-KR",
    model="chirp_3",
)
```

#### OpenAISttAdapter 옵션

OpenAI Realtime Transcription API를 사용합니다. 서버 측 VAD로 발화 구간을 자동 감지합니다.

```typescript
// TypeScript
import { OpenAISttAdapter } from 'dvgateway-adapters/stt';
const stt = new OpenAISttAdapter({
  apiKey: 'sk-xxx',               // 필수
  language: 'ko',                  // 기본: "ko"
  model: 'gpt-4o-transcribe',     // gpt-4o-transcribe, gpt-4o-mini-transcribe
  vadEnabled: true,                // 서버 VAD 활성화 (기본: true)
  vadThreshold: 0.4,               // 감도 0~1 (낮을수록 민감, 기본: 0.4)
  silenceDurationMs: 200,          // 발화 종료 판단 무음 (ms, 기본: 200)
  prefixPaddingMs: 200,            // 발화 시작 전 포함 오디오 (ms, 기본: 200)
});
```

```python
# Python
from dvgateway.adapters.stt import OpenAISttAdapter
stt = OpenAISttAdapter(
    api_key="sk-xxx",
    language="ko",
    model="gpt-4o-transcribe",
    vad_enabled=True,
    vad_threshold=0.4,
    silence_duration_ms=200,
    prefix_padding_ms=200,
)
```

### LLM (AI 대화)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `AnthropicAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | Anthropic Claude |
| `OpenAILlmAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | OpenAI GPT |
| `WebhookAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | n8n/Flowise/사내 API Webhook |

#### AnthropicAdapter 옵션

```typescript
// TypeScript
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
const llm = new AnthropicAdapter({
  apiKey: 'sk-ant-xxx',                    // 필수
  model: 'claude-sonnet-4-6',              // claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
  systemPrompt: '친절한 AI 상담원입니다.',    // 시스템 프롬프트
  maxTokens: 1024,                          // 최대 출력 토큰
  temperature: 0.7,                         // 창의성 (0~1)
  topP: undefined,                          // nucleus sampling
  stopSequences: [],                        // 종료 시퀀스
});
```

```python
# Python
from dvgateway.adapters.llm import AnthropicAdapter
llm = AnthropicAdapter(
    api_key="sk-ant-xxx",
    model="claude-sonnet-4-6",
    system_prompt="친절한 AI 상담원입니다.",
    max_tokens=1024,
    temperature=0.7,
)
```

#### OpenAILlmAdapter 옵션

```typescript
// TypeScript
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
const llm = new OpenAILlmAdapter({
  apiKey: 'sk-xxx',                         // 필수
  model: 'gpt-4o-mini',                     // gpt-4o-mini, gpt-4o, o3-mini, o1-mini
  systemPrompt: '친절한 AI 상담원입니다.',    // 시스템 프롬프트
  maxTokens: 1024,
  temperature: 0.7,
  presencePenalty: 0.0,                     // 반복 억제 (0~2)
  frequencyPenalty: 0.0,                    // 빈도 패널티 (0~2)
});
```

```python
# Python
from dvgateway.adapters.llm import OpenAILlmAdapter
llm = OpenAILlmAdapter(
    api_key="sk-xxx",
    model="gpt-4o-mini",
    system_prompt="친절한 AI 상담원입니다.",
    max_tokens=1024,
    temperature=0.7,
    presence_penalty=0.0,
    frequency_penalty=0.0,
)
```

#### WebhookAdapter 옵션 (n8n, Flowise, 사내 API 연동)

```typescript
// TypeScript
import { WebhookAdapter } from 'dvgateway-adapters/llm';
const llm = new WebhookAdapter({
  url: 'https://n8n.example.com/webhook/voice-bot',  // 필수
  timeout: 5000,                                       // 타임아웃 (ms)
  secret: 'hmac-secret',                               // HMAC-SHA256 서명 키
  headers: { 'X-Custom': 'value' },                    // 커스텀 헤더
  systemPrompt: '상담원 봇입니다.',
  fallback: new AnthropicAdapter({ apiKey: '...' }),   // 장애 시 폴백 어댑터
});
```

```python
# Python
from dvgateway.adapters.llm import WebhookAdapter, AnthropicAdapter
llm = WebhookAdapter(
    url="https://n8n.example.com/webhook/voice-bot",
    timeout=5.0,
    secret="hmac-secret",
    headers={"X-Custom": "value"},
    system_prompt="상담원 봇입니다.",
    fallback=AnthropicAdapter(api_key="..."),
)
```

### TTS (텍스트→음성)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `GeminiTtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | Google Gemini TTS (30 음성) |
| `ElevenLabsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | ElevenLabs (한국어 9 네이티브 음성) |
| `OpenAITtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | OpenAI TTS (11 음성) |
| `CosyVoiceAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | Alibaba CosyVoice (9 음성) |
| `CachedTtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | TTS 캐시 래퍼 (비용 절감) |

#### GeminiTtsAdapter 옵션

```typescript
// TypeScript
import { GeminiTtsAdapter, GEMINI_TTS_VOICES } from 'dvgateway-adapters/tts';
const tts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxx',           // 필수
  voice: 'Kore',                // 기본: "Kore" (30개 음성: Aoede, Charon, Fenrir, Kore, Puck, ...)
  model: 'gemini-2.5-flash-tts', // gemini-2.5-flash-tts, gemini-2.5-pro-tts
  languageCode: 'ko-KR',        // 기본: "ko-KR"
  prompt: '밝고 친근한 톤으로',    // 스타일 제어 (선택)
});
```

```python
# Python
from dvgateway.adapters.tts import GeminiTtsAdapter, GEMINI_VOICES
tts = GeminiTtsAdapter(
    api_key="AIza_xxx",
    voice="Kore",
    model="gemini-2.5-flash-tts",
    language="ko-KR",
)
```

#### ElevenLabsAdapter 옵션

```typescript
// TypeScript
import { ElevenLabsAdapter, ELEVENLABS_KOREAN_VOICES } from 'dvgateway-adapters/tts';
const tts = new ElevenLabsAdapter({
  apiKey: 'el_xxx',                        // 필수
  voiceId: '21m00Tcm4TlvDq8ikWAM',        // 기본: Rachel (한국어 네이티브 9개 사용 가능)
  model: 'eleven_multilingual_v2',          // eleven_multilingual_v2, eleven_flash_v2_5
  stability: 0.3,                           // 안정성 (0~1)
  similarityBoost: 0.75,                    // 유사도 (0~1)
  style: 0.6,                               // 스타일 강도 (0~1)
  useSpeakerBoost: true,                    // 화자 부스트
  outputFormat: 'pcm_24000',                // 출력 포맷
  optimizeStreamingLatency: 3,              // 0~4 (높을수록 빠름, 품질 트레이드오프)
  humanVoice: true,                         // 한국어 최적화 프리셋 (stability/style 자동 조정)
});
// 한국어 네이티브 음성: ELEVENLABS_KOREAN_VOICES (9개)
```

```python
# Python
from dvgateway.adapters.tts import ElevenLabsAdapter, KOREAN_VOICES
tts = ElevenLabsAdapter(
    api_key="el_xxx",
    voice_id="21m00Tcm4TlvDq8ikWAM",
    model="eleven_multilingual_v2",
    stability=0.3,
    similarity_boost=0.75,
    style=0.6,
    use_speaker_boost=True,
    output_format="pcm_24000",
    optimize_streaming_latency=3,
    human_voice=True,
)
```

#### OpenAITtsAdapter 옵션

```typescript
// TypeScript
import { OpenAITtsAdapter } from 'dvgateway-adapters/tts';
const tts = new OpenAITtsAdapter({
  apiKey: 'sk-xxx',                        // 필수
  voice: 'nova',                           // alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse
  model: 'gpt-4o-mini-tts',               // gpt-4o-mini-tts, tts-1
  voiceInstructions: '밝고 친근한 톤',      // 음성 스타일 지시 (gpt-4o-mini-tts 전용)
  humanVoice: true,                        // 한국어 최적화 프리셋
});
```

```python
# Python
from dvgateway.adapters.tts import OpenAITtsAdapter
tts = OpenAITtsAdapter(
    api_key="sk-xxx",
    voice="nova",
    model="gpt-4o-mini-tts",
    voice_instructions="밝고 친근한 톤",
    human_voice=True,
)
```

#### CosyVoiceAdapter 옵션 (Alibaba)

```typescript
// TypeScript
import { CosyVoiceAdapter, COSYVOICE_VOICES } from 'dvgateway-adapters/tts';
const tts = new CosyVoiceAdapter({
  apiKey: 'sk-xxx',                         // 필수 (DashScope API 키)
  voice: 'longxiaochun',                    // longxiaochun, longyue, longwan, longjing, longshuo, longhua, longfei, longshu
  model: 'cosyvoice-v3.5-plus',             // cosyvoice-v3.5-plus, cosyvoice-v3.5-flash
  language: [],                              // 언어 힌트 (선택)
  sampleRate: 16000,                         // 샘플레이트
});
```

```python
# Python
from dvgateway.adapters.tts import CosyVoiceAdapter, COSYVOICE_VOICES
tts = CosyVoiceAdapter(
    api_key="sk-xxx",
    voice="longxiaochun",
    model="cosyvoice-v3.5-plus",
    language_hints=["ko"],
)
```

#### CachedTtsAdapter (비용 절감 래퍼)

반복 멘트(인사말, 안내문 등)를 캐시하여 TTS 비용을 절감합니다.

```typescript
// TypeScript
import { CachedTtsAdapter, ElevenLabsAdapter } from 'dvgateway-adapters/tts';
const inner = new ElevenLabsAdapter({ apiKey: '...' });
const tts = new CachedTtsAdapter(inner, {
  provider: 'elevenlabs',      // 캐시 키 구분용
  cacheDir: './tts-cache',     // 캐시 디렉토리
  ttlMs: 0,                    // 만료시간 (0=무제한)
  maxEntries: 0,               // 최대 캐시 수 (0=무제한)
});
```

```python
# Python
from dvgateway.adapters.tts import CachedTtsAdapter, ElevenLabsAdapter
inner = ElevenLabsAdapter(api_key="...")
tts = CachedTtsAdapter(inner, provider="elevenlabs", cache_dir="./tts-cache")
```

### Realtime (음성→음성 직통)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `OpenAIRealtimeAdapter` | `dvgateway-adapters/realtime` / `dvgateway.adapters.realtime` | OpenAI Realtime API (STT+LLM+TTS 통합) |

#### OpenAIRealtimeAdapter 옵션

STT·LLM·TTS를 하나의 WebSocket으로 통합하여 초저지연 음성 대화를 구현합니다.

```typescript
// TypeScript
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';
const realtime = new OpenAIRealtimeAdapter({
  apiKey: 'sk-xxx',                               // 필수
  model: 'gpt-4o-realtime-preview',               // gpt-4o-realtime-preview, gpt-4o-mini-realtime-preview
  voice: 'alloy',                                  // alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse
  instructions: '친절한 한국어 AI 상담원입니다.',     // 시스템 지시
  inputTranscription: true,                        // 입력 텍스트 변환
  language: 'ko',                                   // 전사 언어 힌트 (BCP-47: "ko", "en", "ja" 등, 미설정 시 자동 감지)
  temperature: 0.8,
  maxResponseTokens: 'inf',                        // 최대 응답 토큰 ("inf" = 무제한)
  turnDetection: {                                  // VAD 설정
    mode: 'server_vad',                            // "server_vad" | "none"
    threshold: 0.5,                                // 감도 (0~1)
    prefixPaddingMs: 300,
    silenceDurationMs: 200,
  },
});
```

```python
# Python
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter, OpenAIRealtimeTurnDetectionOptions

realtime = OpenAIRealtimeAdapter(
    api_key="sk-xxx",
    model="gpt-4o-realtime-preview",
    voice="alloy",
    instructions="친절한 한국어 AI 상담원입니다.",
    input_transcription=True,
    language="ko",               # 전사 언어 힌트 (BCP-47, 미설정 시 자동 감지)
    temperature=0.8,
    max_response_tokens="inf",
    # turn_detection: dict 또는 OpenAIRealtimeTurnDetectionOptions 모두 가능
    turn_detection={                          # dict 방식 ✅
        "mode": "server_vad",
        "threshold": 0.5,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 200,
    },
    # 또는 dataclass 방식:
    # turn_detection=OpenAIRealtimeTurnDetectionOptions(
    #     mode="server_vad", threshold=0.5,
    #     prefix_padding_ms=300, silence_duration_ms=200,
    # ),
)
```

#### S2S vs 기존 파이프라인 비교

| | 기존 파이프라인 (STT→LLM→TTS) | S2S (OpenAI Realtime) |
|---|---|---|
| 구성 | STT + LLM + TTS 어댑터 3개 | `OpenAIRealtimeAdapter` 1개 |
| API 키 | 프로바이더별 개별 키 | OpenAI 키 1개 |
| 레이턴시 | ~500ms+ (3-hop) | ~300ms (단일 WebSocket) |
| LLM 선택 | Claude, GPT, Webhook 등 | GPT-4o 전용 |
| TTS 음색 | ElevenLabs 커스텀, Gemini 30종 등 | OpenAI 내장 11종 |
| STT 모델 | Deepgram, Google Chirp3 등 | Whisper-1 고정 |
| 파이프라인 훅 | onBeforeChat/onAfterChat 지원 | 불가 (중간 텍스트 접근 불가) |
| 비용 | 프로바이더별 개별 과금 | 오디오 토큰 기반 통합 과금 |

#### S2S 완전한 사용 예제

```typescript
// TypeScript — S2S 음성 봇 (STT/LLM/TTS 설정 불필요)
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL']!,
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY']! },
});

const realtime = new OpenAIRealtimeAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-realtime-preview',
  voice: 'nova',
  instructions: '당신은 친절한 한국어 음성 어시스턴트입니다. 짧고 명확하게 답변하세요.',
  language: 'ko',
  turnDetection: { mode: 'server_vad', threshold: 0.5, silenceDurationMs: 200 },
});

// AI 응답 오디오 → 통화 채널에 주입
realtime.onAudioOutput(async (pcm16k, linkedId) => {
  await gw.injectTTS(linkedId, pcm16k);
});

// 전사 결과 수신 (speaker: 'customer' | 'agent')
realtime.onTranscript((result) => {
  console.log(`[${result.speaker}] ${result.text}`);
});

realtime.onError((err, linkedId) => {
  console.error(`[S2S ERROR] ${linkedId}: ${err.message}`);
});

// 통화 이벤트 구독
gw.onCallInfo(async (event) => {
  if (event.type === 'call:new') {
    const stream = gw.streamAudio(event.linkedId, { dir: 'both' });
    await realtime.startSession(event.linkedId, stream);
  }
  if (event.type === 'call:ended') {
    await realtime.stop(event.linkedId);
  }
});

await gw.connect();
```

```python
# Python — S2S 음성 봇
import asyncio, os
from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter

gw = DVGatewayClient(
    base_url=os.environ["DV_BASE_URL"],
    auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
)

realtime = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-4o-realtime-preview",
    voice="nova",
    instructions="당신은 친절한 한국어 음성 어시스턴트입니다. 짧고 명확하게 답변하세요.",
    language="ko",
    turn_detection={"mode": "server_vad", "threshold": 0.5, "silence_duration_ms": 200},
)

def on_audio(pcm16k: bytes, linked_id: str):
    asyncio.ensure_future(gw.inject_tts(linked_id, pcm16k))

realtime.on_audio_output(on_audio)
realtime.on_transcript(lambda r: print(f"[{r.speaker}] {r.text}"))
realtime.on_error(lambda err, lid: print(f"[S2S ERROR] {lid}: {err}"))

async def on_call(event):
    if event["type"] == "call:new":
        stream = gw.stream_audio(event["linkedId"], dir="both")
        await realtime.start_session(event["linkedId"], stream)
    elif event["type"] == "call:ended":
        await realtime.stop(event["linkedId"])

gw.on_call_info(on_call)
asyncio.run(gw.connect())
```

#### S2S 채널에 별도 TTS 삽입

S2S 진행 중 별도 TTS 오디오(공지, 안내음 등)를 삽입할 수 있지만, S2S 응답 오디오와 겹침 방지를 위해 진행 중인 응답을 먼저 취소해야 합니다.

```typescript
// S2S 응답 중단 → 별도 TTS 삽입 → 재개
// 주의: 현재 어댑터는 내부 WebSocket을 직접 노출하지 않으므로,
// response.cancel이 필요한 경우 어댑터를 확장하거나
// S2S가 응답하지 않는 타이밍에 삽입하세요.

// 방법 1: S2S 미응답 구간에 삽입 (안전)
await gw.injectTTS(linkedId, announcementPcm);

// 방법 2: S2S 세션 일시 정지 후 삽입
await realtime.stop(linkedId);          // S2S 세션 종료
await gw.injectTTS(linkedId, announcePcm); // TTS 삽입
// 필요 시 S2S 세션 재시작
const stream = gw.streamAudio(linkedId, { dir: 'both' });
await realtime.startSession(linkedId, stream);
```

#### 대시보드 S2S 설정

게이트웨이 대시보드에서 S2S를 설정할 수 있습니다:

1. **프로바이더 API 키** 탭 → S2S (Speech-to-Speech) 섹션 → OpenAI Realtime API 활성화 + API 키 입력
2. **파이프라인 설정** 탭 → S2S 모드 활성화 → 프로바이더, 모델, 음성, 시스템 지시 설정

대시보드에서 설정하면 SDK에서 `GET /api/v1/config/pipeline`으로 설정을 가져와 자동 적용할 수 있습니다.

#### S2S Tool Calling (Function Calling)

S2S 세션에서 모델이 외부 함수를 호출할 수 있습니다. DB 조회, API 호출, 주문 처리 등에 활용합니다.

```typescript
// TypeScript — S2S + Tool Calling
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';
import type { OpenAIRealtimeTool, RealtimeToolCall } from 'dvgateway-adapters/realtime';

const tools: OpenAIRealtimeTool[] = [
  {
    type: 'function',
    name: 'lookup_order',
    description: '주문번호로 주문 상태를 조회합니다.',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: '주문번호' },
      },
      required: ['order_id'],
    },
  },
  {
    type: 'function',
    name: 'transfer_agent',
    description: '상담원에게 통화를 전환합니다.',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string', description: '부서명 (예: 배송, 결제, 반품)' },
      },
      required: ['department'],
    },
  },
];

const realtime = new OpenAIRealtimeAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-realtime-preview',
  voice: 'nova',
  language: 'ko',
  instructions: '주문 관련 문의 시 lookup_order를 호출하세요. 상담원 요청 시 transfer_agent를 호출하세요.',
  tools,
  toolChoice: 'auto',   // "auto" | "none" | "required" | { type: "function", name: "fn" }
});

// 모델이 함수 호출 시 실행
realtime.onToolCall(async (call: RealtimeToolCall) => {
  console.log(`[TOOL] ${call.name}(${JSON.stringify(call.args)})`);

  if (call.name === 'lookup_order') {
    const status = await db.getOrderStatus(call.args.order_id as string);
    realtime.submitToolResult(call.linkedId, call.callId, { status, eta: '2일 후 도착' });
  }
  if (call.name === 'transfer_agent') {
    realtime.submitToolResult(call.linkedId, call.callId, { transferred: true });
    // 실제 전환 로직...
  }
});
```

```python
# Python — S2S + Tool Calling
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter, RealtimeToolCall

tools = [
    {
        "type": "function",
        "name": "lookup_order",
        "description": "주문번호로 주문 상태를 조회합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "주문번호"},
            },
            "required": ["order_id"],
        },
    },
]

realtime = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-4o-realtime-preview",
    voice="nova",
    language="ko",
    instructions="주문 관련 문의 시 lookup_order를 호출하세요.",
    tools=tools,              # list[dict] 또는 list[OpenAIRealtimeTool]
    tool_choice="auto",       # "auto" | "none" | "required" | {"type":"function","name":"fn"}
)

def handle_tool_call(call: RealtimeToolCall):
    print(f"[TOOL] {call.name}({call.args})")
    if call.name == "lookup_order":
        status = db.get_order_status(call.args["order_id"])
        realtime.submit_tool_result(call.linked_id, call.call_id, {"status": status})

realtime.on_tool_call(handle_tool_call)
```

**Tool Calling 흐름:**
1. 사용자 발화 → 모델이 함수 호출 필요 판단
2. `onToolCall` / `on_tool_call` 핸들러 호출 (callId, name, args 전달)
3. 함수 실행 후 `submitToolResult` / `submit_tool_result`로 결과 반환
4. 모델이 결과를 반영하여 음성 응답 생성

TTS 선택 가이드: `GEMINI` (가성비·30음성) / `ELEVENLABS` (최고 품질·한국어 네이티브) / `OPENAI` (voiceInstructions·스타일 제어) / `COSYVOICE` (중국어 특화·저비용)

---

## 환경변수

```bash
# 게이트웨이 연결
DV_BASE_URL=http://localhost:8080    # 게이트웨이 API 주소
DV_API_KEY=dvgw_xxx                  # SDK API 키

# STT 프로바이더
DEEPGRAM_API_KEY=dg_xxx              # Deepgram
GOOGLE_STT_API_KEY=project:key       # Google Chirp3 (V2: "project_id:key")

# LLM 프로바이더
ANTHROPIC_API_KEY=sk-ant-xxx         # Anthropic Claude
OPENAI_API_KEY=sk-xxx                # OpenAI GPT (LLM + TTS + STT + Realtime 공용)

# TTS 프로바이더
GEMINI_API_KEY=AIza_xxx              # Google Gemini TTS
ELEVENLABS_API_KEY=el_xxx            # ElevenLabs
COSYVOICE_API_KEY=sk-xxx             # Alibaba CosyVoice (DashScope)
TTS_PROVIDER=gemini                  # gemini / elevenlabs / openai / cosyvoice
```

---

## 멀티테넌트

- 테넌트 클라이언트: JWT에 포함된 `tenantId`로 자동 격리
- Admin (`tenantId=""`): 모든 테넌트 데이터 접근 가능
- 착신전환 API: `tenantId` 쿼리 파라미터 또는 JWT 자동

---

## 문서 참조

| 문서 | 내용 |
|------|------|
| [SDK 가이드 (전체)](https://github.com/OLSSOO-Inc/dvgateway-releases) | 설치부터 고급 기능까지 |
| [PBX 관리 API](docs/pbx-management-api.md) | 착신전환, 발신자표시, 클릭투콜, 캠페인 REST API |
| [퀵 매뉴얼](docs/pbx-quick-reference.md) | curl 예제 복사해서 바로 사용 |
| [어댑터 상세](docs/sdk-guide/04-adapter-reference.md) | STT/LLM/TTS 설정 |
| [캠페인 가이드](docs/sdk-guide/11-pbx-management.md) | 캠페인 + 이벤트 모니터링 |

---

_최종 업데이트: 2026-04-06_
