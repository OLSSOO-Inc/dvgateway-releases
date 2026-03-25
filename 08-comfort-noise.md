# Comfort Noise — AI 처리 중 무음 방지

## 16. Comfort Noise — AI 처리 중 무음 방지

AI 음성 봇은 사용자 발화 후 응답을 생성하는 동안(STT → LLM → TTS) 0.5~3초의 무음(dead air)이 발생합니다.
이 침묵은 사용자가 "전화가 끊어졌나?" 또는 "봇이 멈췄나?"라고 느끼게 만들어 통화 포기율을 높입니다.

**Comfort Noise** 기능은 이 문제를 해결합니다:
- 게이트웨이가 저수준 배경 소음을 통화 채널에 자동 주입
- SDK가 "지금 AI 처리 중이다" 시그널을 보내면 즉시 활성화
- TTS 응답 재생이 시작되면 자동으로 fade-out 후 중단

### Comfort Noise 서버 설정

게이트웨이 환경변수(`.env` 또는 `/etc/dvgateway/env`)에 추가하세요:

```bash
# 기본: 합성 배경 노이즈 (-50 dBFS)
GW_COMFORT_NOISE_ENABLED=true
GW_COMFORT_NOISE_LEVEL=-50
```

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GW_COMFORT_NOISE_ENABLED` | `false` | comfort noise 기능 활성화 |
| `GW_COMFORT_NOISE_LEVEL` | `-50` | 합성 노이즈 레벨 (dBFS). -60=거의 안 들림, -50=미묘한 배경음, -40=인지 가능 |
| `GW_COMFORT_NOISE_FILE` | (없음) | 커스텀 배경음 PCM 파일 경로 (아래 "커스텀 배경음" 섹션 참조) |

설정 변경 후 게이트웨이를 재시작하세요:

```bash
sudo systemctl restart dvgateway
```

### 자동 모드 — 파이프라인 빌더 (권장)

파이프라인 빌더를 사용하면 **별도 코드 없이 자동으로 동작합니다.**
SDK가 내부적으로 STT 완료 → `thinking:start`, TTS 시작 전 → `thinking:stop` 시그널을 전송합니다.

**Node.js:**

```javascript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const gw = new DVGatewayClient({
  baseUrl: 'https://your-gateway.example.com',
  auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY },
});

// 파이프라인만 설정하면 comfort noise는 자동 동작!
// STT 완료 → thinking:start (배경음 시작)
// LLM 응답 완료 → thinking:stop (배경음 중단)
// TTS 재생 시작 (자연스러운 전환)
await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_KEY,
    language: 'ko',
  }))
  .llm(new AnthropicAdapter({
    apiKey: process.env.ANTHROPIC_KEY,
    model: 'claude-sonnet-4-20250514',
    systemPrompt: '한국어로 친절하게 응답하세요.',
  }))
  .tts(new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_KEY,
    voiceId: 'pNInz6obpgDQGcFmaJgB',  // Korean voice
  }))
  .onNewCall((session) => {
    console.log(`📞 새 통화: ${session.linkedId}`);
  })
  .onTranscript((result, session) => {
    console.log(`🗣️ [${session.linkedId}] "${result.text}"`);
    // 이 시점에서 comfort noise가 자동으로 시작됩니다
  })
  .start();
```

**Python:**

```python
import asyncio
import os
from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

gw = DVGatewayClient(
    base_url="https://your-gateway.example.com",
    auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
)

# 파이프라인 빌더 사용 시 comfort noise 자동 동작
await (
    gw.pipeline()
    .stt(DeepgramAdapter(api_key=os.environ["DEEPGRAM_KEY"], language="ko"))
    .llm(AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_KEY"],
        model="claude-sonnet-4-20250514",
        system_prompt="한국어로 친절하게 응답하세요.",
    ))
    .tts(ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_KEY"],
        voice_id="pNInz6obpgDQGcFmaJgB",
    ))
    .on_new_call(lambda s: print(f"📞 새 통화: {s.linked_id}"))
    .on_transcript(lambda r, s: print(f'🗣️ [{s.linked_id}] "{r.text}"'))
    .start()
)
```

### 수동 모드 — WebSocket 시그널

오디오 스트림 WebSocket을 직접 사용하는 경우, 생각 시그널을 수동으로 보낼 수 있습니다.

**Node.js:**

```javascript
// 1. 오디오 스트림 연결
const audioStream = gw.streamAudio(linkedId);

// 2. STT 어댑터로 오디오 전달
sttAdapter.startStream(linkedId, audioStream);

// 3. 발화 감지 시 thinking 시그널 전송
sttAdapter.onTranscript(async (result) => {
  if (!result.isFinal) return;

  // comfort noise 시작 (게이트웨이가 배경음 주입)
  audioStream.sendThinkingStart();

  try {
    // LLM 호출
    const response = await callLLM(result.text);

    // comfort noise 중단 (TTS 시작 전)
    audioStream.sendThinkingStop();

    // TTS 재생
    await gw.say(linkedId, response, ttsAdapter);
  } catch (err) {
    // 에러 시에도 반드시 중단
    audioStream.sendThinkingStop();
    console.error('Pipeline error:', err);
  }
});
```

**Python:**

```python
# 1. 오디오 스트림 연결
audio_stream = gw.stream_audio(linked_id)

# 2. STT 어댑터로 오디오 전달
await stt_adapter.start_stream(linked_id, audio_stream)

# 3. 발화 감지 시 thinking 시그널 전송
async def on_transcript(result):
    if not result.is_final:
        return

    # comfort noise 시작
    await audio_stream.send_thinking_start()

    try:
        # LLM 호출
        response = await call_llm(result.text)

        # comfort noise 중단
        await audio_stream.send_thinking_stop()

        # TTS 재생
        await gw.say(linked_id, response, tts_adapter)
    except Exception as e:
        await audio_stream.send_thinking_stop()
        print(f"Pipeline error: {e}")

stt_adapter.on_transcript(on_transcript)
```

**Raw WebSocket (프레임워크 없이 직접 연동):**

```
오디오 스트림 연결: ws://gateway:8080/api/v1/ws/stream?linkedid=XXX

// 게이트웨이 → AI 서비스: Binary frames (640 bytes slin16 PCM)
// AI 서비스 → 게이트웨이: Text frames (JSON 시그널)

// AI 처리 시작 시 (text frame 전송):
{"type":"thinking:start"}

// AI 처리 완료 시 (text frame 전송):
{"type":"thinking:stop"}
```

### 수동 모드 — REST API

WebSocket을 사용하지 않는 환경(HTTP-only)에서도 REST API로 제어할 수 있습니다.

**Node.js:**

```javascript
// REST API 방식 (HTTP POST)
await gw.startThinking(linkedId);   // comfort noise 시작
// ... AI 처리 중 ...
await gw.stopThinking(linkedId);    // comfort noise 중단
```

**Python:**

```python
# REST API 방식
await gw.start_thinking(linked_id)  # comfort noise 시작
# ... AI 처리 중 ...
await gw.stop_thinking(linked_id)   # comfort noise 중단
```

**cURL:**

```bash
# 시작
curl -X POST http://gateway:8080/api/v1/comfort/LINKED_ID/start \
  -H "Authorization: Bearer YOUR_JWT"

# 중단
curl -X POST http://gateway:8080/api/v1/comfort/LINKED_ID/stop \
  -H "Authorization: Bearer YOUR_JWT"

# 세션 상태 확인
curl http://gateway:8080/api/v1/comfort/LINKED_ID/status \
  -H "Authorization: Bearer YOUR_JWT"
# 응답: {"linkedId":"LINKED_ID","enabled":true,"active":true}

# 글로벌 상태 확인
curl http://gateway:8080/api/v1/comfort/status \
  -H "Authorization: Bearer YOUR_JWT"
# 응답: {"enabled":true,"activeCount":3}
```

### 커스텀 배경음 파일

합성 노이즈 대신 사무실 배경음, 자연 소리 등의 녹음 파일을 루프 재생할 수 있습니다.

**PCM 파일 요구사항:**
- 포맷: 헤더 없는 raw PCM (WAV 헤더 없음)
- 샘플레이트: 16kHz
- 비트 깊이: 16-bit signed
- 채널: mono
- 바이트 순서: little-endian

**WAV 파일을 PCM으로 변환:**

```bash
# ffmpeg으로 변환 (가장 권장)
ffmpeg -i office-background.wav \
  -f s16le -ar 16000 -ac 1 \
  /etc/dvgateway/audio/office-ambient.pcm

# sox로 변환
sox office-background.wav \
  -r 16000 -b 16 -c 1 -e signed-integer -L \
  /etc/dvgateway/audio/office-ambient.pcm
```

**게이트웨이 설정:**

```bash
GW_COMFORT_NOISE_ENABLED=true
GW_COMFORT_NOISE_FILE=/etc/dvgateway/audio/office-ambient.pcm
# GW_COMFORT_NOISE_LEVEL은 파일 모드에서 무시됩니다
```

> **팁**: 5~30초 길이의 자연스러운 환경음을 준비하세요. 게이트웨이가 자동으로 무한 루프 재생합니다.

### 고급 활용 — TTS 필러 프레이즈

comfort noise와 함께 "잠시만요", "확인해볼게요" 같은 자연어 필러를 사용하면
더 자연스러운 대화 경험을 제공할 수 있습니다.

**Node.js:**

```javascript
import { CachedTtsAdapter, ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// 필러 프레이즈를 미리 캐시
const tts = new CachedTtsAdapter(
  new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_KEY }),
  { provider: 'elevenlabs', cacheDir: './tts-cache' },
);
await tts.warmup([
  { text: '잠시만요.' },
  { text: '확인해볼게요.' },
  { text: '네, 알겠습니다. 잠시만 기다려주세요.' },
]);

sttAdapter.onTranscript(async (result) => {
  if (!result.isFinal) return;

  // 방법 1: comfort noise + TTS 필러 조합
  audioStream.sendThinkingStart();
  // "잠시만요" 재생 (캐시 히트 — API 호출 없음, <5ms)
  await gw.say(linkedId, '잠시만요.', tts);

  // LLM 처리 중에는 배경 소음이 계속 재생됩니다
  const response = await callLLM(result.text);

  audioStream.sendThinkingStop();
  await gw.say(linkedId, response, tts);
});
```

**Python:**

```python
from dvgateway.adapters.tts import CachedTtsAdapter, ElevenLabsAdapter

# 필러 프레이즈 캐시
tts = CachedTtsAdapter(
    ElevenLabsAdapter(api_key=os.environ["ELEVENLABS_KEY"]),
    provider="elevenlabs",
    cache_dir="./tts-cache",
)
await tts.warmup([
    {"text": "잠시만요."},
    {"text": "확인해볼게요."},
    {"text": "네, 알겠습니다. 잠시만 기다려주세요."},
])

async def on_transcript(result):
    if not result.is_final:
        return

    # comfort noise + 필러 프레이즈
    await audio_stream.send_thinking_start()
    await gw.say(linked_id, "잠시만요.", tts)

    response = await call_llm(result.text)

    await audio_stream.send_thinking_stop()
    await gw.say(linked_id, response, tts)
```

### 동작 흐름 다이어그램

```
사용자: "내일 서울 날씨 알려줘"
  ↓
[STT 처리] ────────────────── 200ms
  ↓
[thinking:start] ─── comfort noise 주입 시작 (fade-in 200ms) ──
  ↓                                                            │
[LLM 처리] "서울 내일 날씨를 검색합니다..." ─── 300ms          │ 배경 소음 재생
  ↓                                                            │ (dead air 방지)
[TTS 합성 시작] ─────────────── 150ms                          │
  ↓                                                            │
[thinking:stop] ──── comfort noise 중단 (fade-out 300ms) ──────┘
  ↓
[TTS 재생] "내일 서울은 맑고 최고 기온 22도입니다."
  ↓
사용자에게 자연스러운 응답 전달 (체감 무음 시간: 0ms)
```

### 제어 방법 비교표

| 방법 | 언어 | 장점 | 단점 |
|------|------|------|------|
| 파이프라인 빌더 (자동) | JS/Python | 코드 변경 없음, 가장 간편 | 타이밍 커스터마이즈 불가 |
| WebSocket 시그널 (수동) | JS/Python | 정밀한 타이밍 제어, 저레이턴시 | 직접 start/stop 관리 필요 |
| REST API (수동) | Any | 언어 무관, HTTP만으로 제어 | HTTP 오버헤드 (~10ms) |

---

