# STT·TTS API 비용 절감

## 15. STT·TTS API 비용 절감 — 캐시 및 최적화 전략

운영 환경에서 STT·TTS API 비용은 통화량에 비례하여 빠르게 증가합니다.
아래 전략을 조합하면 **TTS 비용을 50~90%**, **STT 비용을 20~40%** 절감할 수 있습니다.

---

### TTS 캐시 어댑터 (CachedTtsAdapter)

`CachedTtsAdapter`는 기존 TTS 어댑터를 감싸서 **디스크 기반 PCM 캐시**를 제공합니다.
동일한 `(텍스트 + 화자 + 프로바이더 + 모델 + 속도)` 조합은 최초 1회만 API를 호출하고,
이후에는 캐시된 PCM 파일에서 즉시 반환합니다. **서버 재시작/업데이트 후에도 캐시가 유지됩니다.**

#### 핵심 원리

```
요청: synthesize("안녕하세요", voiceId="abc")
        ↓
  캐시 키 생성: SHA-256("elevenlabs|model|abc|1.0|안녕하세요")
        ↓
  ┌─ 캐시 HIT → 디스크에서 PCM 읽기 (0ms, API 비용 $0)
  └─ 캐시 MISS → API 호출 → PCM 저장 → 다음부터 HIT
```

#### Node.js 사용법

```typescript
import { ElevenLabsAdapter, CachedTtsAdapter } from 'dvgateway-adapters';

// 1. 기본 TTS 어댑터 생성
const baseTts = new ElevenLabsAdapter({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel
  model: 'eleven_flash_v2_5',
});

// 2. CachedTtsAdapter로 감싸기
const tts = new CachedTtsAdapter(baseTts, {
  provider:       'elevenlabs',          // 캐시 키에 포함
  cacheDir:       './tts-cache',         // 캐시 디렉토리 (재시작 후에도 유지)
  defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
  defaultModel:   'eleven_flash_v2_5',
  ttlMs:          7 * 24 * 60 * 60 * 1000, // 7일 후 자동 만료 (0=무제한)
  maxEntries:     500,                     // 최대 500개 (LRU 방식 자동 삭제)
});

// 3. 파이프라인에서 그대로 사용 (TtsAdapter 인터페이스 호환)
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)   // ← CachedTtsAdapter를 직접 전달
  .start();

// 4. say() / broadcastSay() 에서도 동일하게 사용
await gw.say(linkedId, '안녕하세요', tts);              // 캐시 히트 시 API 무호출
await gw.broadcastSay(confId, '회의를 시작합니다.', tts); // 컨퍼런스 방송
```

#### Python 사용법

```python
from dvgateway.adapters.tts import ElevenLabsAdapter, CachedTtsAdapter

# 1. 기본 TTS 어댑터 생성
base_tts = ElevenLabsAdapter(
    api_key=os.environ["ELEVENLABS_API_KEY"],
    voice_id="21m00Tcm4TlvDq8ikWAM",
    model="eleven_flash_v2_5",
)

# 2. CachedTtsAdapter로 감싸기
tts = CachedTtsAdapter(
    base_tts,
    provider="elevenlabs",
    cache_dir="./tts-cache",
    default_voice_id="21m00Tcm4TlvDq8ikWAM",
    default_model="eleven_flash_v2_5",
    ttl_ms=7 * 24 * 60 * 60 * 1000,  # 7일
    max_entries=500,
)

# 3. 파이프라인에서 사용
await (
    gw.pipeline()
    .stt(stt)
    .llm(llm)
    .tts(tts)
    .start()
)

# 4. say() / broadcast_say()에서 사용
await gw.say(linked_id, "안녕하세요", tts)
await gw.broadcast_say(conf_id, "회의를 시작합니다.", tts)
```

#### 캐시 옵션 상세

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `provider` | string | (필수) | 프로바이더 이름 (`"elevenlabs"`, `"openai"` 등). 캐시 키에 포함 |
| `cacheDir` / `cache_dir` | string | `"./tts-cache"` | 캐시 디렉토리 경로. 없으면 자동 생성 |
| `defaultVoiceId` / `default_voice_id` | string | `"default"` | 기본 화자 ID |
| `defaultModel` / `default_model` | string | `"default"` | 기본 모델명 |
| `ttlMs` / `ttl_ms` | number | `0` (무제한) | 캐시 만료 시간 (밀리초). 만료된 파일은 자동 삭제 |
| `maxEntries` / `max_entries` | number | `0` (무제한) | 최대 캐시 항목 수. 초과 시 가장 오래된 항목부터 LRU 삭제 |

#### 캐시 관리 API

```typescript
// 캐시 통계 확인
const stats = tts.getStats();
console.log(`히트: ${stats.hits}, 미스: ${stats.misses}`);

// 특정 텍스트가 캐시에 있는지 확인
const cached = await tts.isCached('안녕하세요');

// 캐시 전체 삭제
const removed = await tts.clearCache();
```

```python
# Python
stats = tts.get_stats()
print(f"히트: {stats.hits}, 미스: {stats.misses}")

cached = await tts.is_cached("안녕하세요")
removed = await tts.clear_cache()
```

---

### 안내 멘트 음원 풀 사전 생성 (warmup)

`warmup()` 메서드를 사용하면 서버 시작 시 자주 사용하는 안내 멘트를 **미리 합성하여 캐시에 저장**합니다.
이미 캐시에 있는 항목은 건너뛰므로 재시작 후에도 불필요한 API 호출이 발생하지 않습니다.

#### Node.js

```typescript
// 서버 시작 시 실행
const ANNOUNCEMENTS = [
  { text: '안녕하세요. 얼쑤팩토리 고객센터에 전화해 주셔서 감사합니다.' },
  { text: '잠시만 기다려 주세요. 상담사에게 연결하겠습니다.' },
  { text: '현재 상담 대기 중입니다. 잠시만 기다려 주세요.' },
  { text: '통화가 종료되었습니다. 이용해 주셔서 감사합니다.' },
  { text: '업무 시간이 종료되었습니다.' },
  { text: '본 통화는 서비스 품질 향상을 위해 녹음됩니다.' },
];

// warmup() — 캐시에 없는 항목만 API 호출
const newCount = await tts.warmup(ANNOUNCEMENTS);
console.log(`${newCount}개 새로 생성, ${ANNOUNCEMENTS.length - newCount}개 캐시 히트`);
// 재시작 후: "0개 새로 생성, 6개 캐시 히트" → API 비용 $0
```

#### Python

```python
ANNOUNCEMENTS = [
    {"text": "안녕하세요. 얼쑤팩토리 고객센터입니다."},
    {"text": "잠시만 기다려 주세요."},
    {"text": "상담사에게 연결하겠습니다."},
]

new_count = await tts.warmup(ANNOUNCEMENTS)
print(f"{new_count}개 새로 생성")
```

#### warmup 항목에 화자·속도 지정

```typescript
const ANNOUNCEMENTS = [
  { text: '안녕하세요.', voiceId: 'voice-ko-female' },
  { text: 'Hello.', voiceId: 'voice-en-male', speed: 0.9 },
];
await tts.warmup(ANNOUNCEMENTS);
```

#### 운영 시나리오 예시

```
[최초 배포]
  warmup() → 7개 멘트 API 호출 → 캐시 저장
  비용: ElevenLabs 7건 호출 ≈ $0.01

[업데이트 후 재시작]
  warmup() → 7개 모두 캐시 히트 → API 호출 0건
  비용: $0

[하루 1,000콜 × 안내 멘트 3회 = 3,000건]
  캐시 미사용: 3,000 API 호출 ≈ $45/일
  캐시 사용:   0 API 호출     = $0/일
  월 절감:     ≈ $1,350
```

---

### STT 비용 최적화 — VAD 필터링

STT API는 **전송한 오디오 시간**에 비례하여 과금됩니다.
침묵 구간을 STT로 보내지 않으면 비용을 크게 줄일 수 있습니다.

#### 방법 1: DVGateway 내장 VAD 필터

파이프라인에 `audioFilter`를 설정하면 DVGateway가 자동으로 침묵 구간을 필터링합니다.

```typescript
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)
  .audioFilter({ dir: 'in' })  // 인바운드(고객 음성)만 STT로 전송
  .start();
```

#### 방법 2: Deepgram 엔드포인팅 최적화

`endpointingMs` 값을 줄이면 발화 끝을 더 빨리 감지하여 불필요한 침묵 전송을 줄입니다.

```typescript
const stt = new DeepgramAdapter({
  apiKey:        process.env.DEEPGRAM_API_KEY!,
  language:      'ko',
  model:         'nova-3',
  endpointingMs: 300,       // 300ms 침묵 시 발화 종료 감지 (기본: 500ms)
  smartFormat:   true,      // 자동 구두점 (추가 비용 없음)
});
```

#### 방법 3: 로컬 STT 사용 (API 비용 $0)

완전 무료로 STT를 사용하려면 로컬 Whisper 모델을 연동합니다.
실시간 처리를 위해서는 GPU 서버가 필요합니다.

| 로컬 STT | 지연시간 | GPU 필요 | 한국어 품질 |
|----------|---------|----------|-----------|
| whisper.cpp | ~500ms | 권장 | 양호 |
| Faster-Whisper | ~300ms | 필수 | 우수 |
| OpenAI Whisper (공식) | ~800ms | 필수 | 우수 |

자세한 설정은 [10. 어댑터별 상세 설정](#10-어댑터별-상세-설정)의 로컬 STT 섹션을 참고하세요.

---

### 프로바이더별 비용 비교표

#### TTS 비용 (1,000자 기준, 2026-03)

| 프로바이더 | 모델 | 1,000자 비용 | 지연시간 | 한국어 |
|-----------|------|-------------|---------|-------|
| ElevenLabs | eleven_flash_v2_5 | ~$0.15 | ~75ms | O |
| ElevenLabs | eleven_multilingual_v2 | ~$0.18 | ~300ms | O |
| OpenAI | tts-1 | ~$0.015 | ~200ms | O |
| OpenAI | tts-1-hd | ~$0.030 | ~400ms | O |
| OpenAI | gpt-4o-mini-tts | ~$0.010 | ~150ms | O |
| Google Cloud TTS | Neural2 | ~$0.016 | ~200ms | O |

> **비용 팁**: 안내 멘트처럼 반복 텍스트가 많은 경우 ElevenLabs + CachedTtsAdapter 조합이
> 고품질 음성을 유지하면서 비용을 거의 $0으로 줄일 수 있습니다.

#### STT 비용 (분당, 2026-03)

| 프로바이더 | 모델 | 분당 비용 | 실시간 | 한국어 |
|-----------|------|----------|-------|-------|
| Deepgram | nova-3 | ~$0.0043 | O | O |
| Deepgram | nova-2 | ~$0.0036 | O | O |
| Google Cloud STT | chirp_2 | ~$0.016 | O | O |
| OpenAI | whisper-1 (API) | ~$0.006 | X (배치) | O |
| 로컬 Whisper | large-v3 | $0 (GPU 비용만) | 조건부 | O |

---

### 비용 최적화 체크리스트

프로덕션 배포 전에 아래 항목을 확인하세요:

- [ ] **TTS 캐시 활성화** — 반복 안내 멘트에 `CachedTtsAdapter` 적용
- [ ] **warmup() 호출** — 서버 시작 스크립트에 `tts.warmup()` 추가
- [ ] **TTL 설정** — 캐시 만료 기간 설정 (음성 스타일 변경 시 갱신)
- [ ] **audioFilter 설정** — 인바운드(`'in'`)만 STT로 전송 (아웃바운드 AI 음성은 불필요)
- [ ] **endpointingMs 최적화** — 300~400ms로 설정하여 침묵 전송 최소화
- [ ] **저비용 LLM 선택** — 단순 안내: `claude-haiku` / `gpt-4o-mini`
- [ ] **캐시 통계 모니터링** — `tts.getStats()`로 히트율 확인 (목표: >80%)
- [ ] **로컬 STT 검토** — GPU 서버가 있다면 Faster-Whisper로 STT 비용 $0 달성

---

