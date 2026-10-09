# 12. 통화 음질 문제 분석 및 대응 가이드 (TTS + STT)

통화 중 음질 이상(TTS 재생 요동, STT 인식 불량, 끊김, 잡음)이 생겼을 때 개발자 쪽에서 확인할 것과, 운영사에 문의할 때 보낼 정보를 안내합니다.

---

## 목차

1. [증상별 분류](#1-증상별-분류)
2. [SDK 측 점검 사항](#2-sdk-측-점검-사항)
3. [게이트웨이 설정이 음질에 미치는 영향](#3-게이트웨이-설정이-음질에-미치는-영향)
4. [일반적 원인과 해결책 — TTS](#4-일반적-원인과-해결책--tts)
5. [일반적 원인과 해결책 — STT](#5-일반적-원인과-해결책--stt)
6. [운영사에 문의할 때](#6-운영사에-문의할-때)

---

## 1. 증상별 분류

### TTS (음성 재생) 문제

| 증상 | 설명 | 주요 원인 |
|------|------|-----------|
| **음질 요동** | 음성과 잡음이 번갈아 들림 | Comfort noise ↔ TTS 전환 타이밍 (thinking 시그널 순서) |
| **간헐적 무음** | TTS 재생 중 짧은 끊김 발생 | AI TTS 서비스 지연 (오디오가 제때 도착하지 않음) |
| **볼륨 변동** | 전체 통화 음량이 불안정 | TTS 소스 볼륨 변동, 게이트웨이 자동 음량 보정 |
| **시작 시 클릭/팝** | TTS 시작 직후 "딱" 소리 | 아웃바운드 통화의 미디어 경로 준비 지연 |
| **종료 시 클릭/팝** | TTS 끝날 때 "딱" 소리 | Fade-out 누락 |
| **에코/반복** | 같은 오디오가 이중 재생 | 같은 통화에 TTS를 중복 전송, 회의 공지 중복 |
| **왜곡/노이즈** | 전체적으로 오디오 품질 저하 | 샘플레이트 불일치 (16kHz vs 8kHz) |

### STT (음성 인식) 문제

| 증상 | 설명 | 주요 원인 |
|------|------|-----------|
| **인식 안됨** | 말해도 텍스트가 전혀 안 나옴 | 오디오 스트림 미연결, STT API 키 오류, 오디오 미전달 |
| **인식 끊김** | 처음엔 되다가 중간에 멈춤 | STT 연결 끊김 (자동 재연결 실패), 무발화 일시 중단 |
| **오인식/정확도 저하** | 텍스트가 나오지만 부정확 | 언어/모델 미스매치, 잡음 혼입, 샘플레이트 불일치 |
| **지연** | 말한 후 텍스트 출력까지 수초 소요 | STT 프로바이더 지연, endpointing 설정 과대 |
| **화자 구분 오류** | 회의에서 발화자가 잘못 표시 | diarization 한계, per-participant 모드 미사용 |
| **TTS 음성 재인식** | AI TTS 응답이 STT에 재입력됨 (에코) | Mix 모드 사용, per-participant 모드 미사용 |
| **비용 과다** | STT 비용이 예상보다 높음 | 무발화 구간에도 계속 전송, 세션 미종료 |

---

## 2. SDK 측 점검 사항

### 2.1 TTS 오디오 포맷 확인

게이트웨이가 수신하는 TTS PCM 포맷은 반드시:
- **16kHz, 16-bit, Signed Linear PCM, mono, little-endian**
- 프레임 크기: 640 bytes (16kHz × 20ms × 2 bytes)

SDK 의 TTS 어댑터(`ElevenLabsAdapter`, `OpenAITtsAdapter`, `GeminiTtsAdapter` 등)는 이미 이 포맷으로 출력합니다. 문제가 되는 것은 **직접 만든 오디오**(녹음 파일, 다른 TTS 서비스 응답)를 `injectTts()` 로 넣을 때입니다:

```typescript
// ❌ 잘못된 예: 8kHz(또는 mp3/wav 헤더 포함) 오디오를 그대로 주입 → 왜곡
await gw.injectTts(linkedId, (async function* () { yield audio8kHz; })());

// ✅ 올바른 예: 16kHz 16-bit mono raw PCM 으로 변환한 뒤 주입
//    (예: ffmpeg -i in.mp3 -ar 16000 -ac 1 -f s16le out.pcm)
await gw.injectTts(linkedId, (async function* () { yield pcm16k; })());

// ✅ 텍스트라면 어댑터에 맡기는 것이 가장 간단합니다
await gw.say(linkedId, '안녕하세요', tts);
```

### 2.2 Thinking 시그널 타이밍

파이프라인 빌더(`gw.pipeline()`)를 쓰면 thinking 시그널은 SDK 가 알아서 보냅니다. 직접 STT/LLM/TTS 를 엮는 경우에만 아래 순서를 지키세요.

```typescript
// ✅ 올바른 순서: AI 처리 시작 → startThinking, 응답 준비 완료 → stopThinking → TTS 주입
await gw.startThinking(linkedId);              // comfort noise 시작
const text = await askLlm(userText);           // (직접 구현한 LLM 호출)
await gw.stopThinking(linkedId);               // comfort noise 중단
await gw.say(linkedId, text, tts);             // TTS 재생 시작
```

```typescript
// ❌ 잘못된 순서: TTS 주입 후 stopThinking — 배경음과 음성이 겹쳐 요동
await gw.say(linkedId, text, tts);
await gw.stopThinking(linkedId);   // 너무 늦음
```

### 2.3 동시 TTS 세션 방지

같은 통화에 새 `injectTts()`/`say()` 가 들어오면 게이트웨이는 **이전 재생을 끊고 새 것을 재생**합니다(이전 재생에는 `tts:playback` 이벤트가 `phase: 'canceled'`, `errorReason: 'preempted'` 로 옵니다). 따라서 "겹쳐 들림"은 보통 **서로 다른 프로세스(구독자)가 같은 통화에 동시에 주입**할 때 생깁니다.

```typescript
import { randomUUID } from 'node:crypto';

// ✅ 한 통화에는 한 곳에서만 주입하고, 이전 재생이 끝난 뒤 다음 문장을 보냅니다.
//    injectId 를 먼저 정해 이벤트를 구독한 뒤 주입해야 이벤트를 놓치지 않습니다.
const injectId = randomUUID();

const unsub = gw.onTtsPlayback(async (ev) => {
  if (ev.injectId !== injectId) return;
  if (ev.phase === 'canceled' && ev.errorReason === 'preempted') {
    console.warn('다른 곳에서 같은 통화에 TTS 를 보내 내 재생이 끊겼습니다');
  }
  if (ev.phase === 'complete' || ev.phase === 'canceled' || ev.phase === 'failed') {
    unsub();
  }
});

await gw.injectTts(linkedId, tts.synthesize('첫 번째 안내입니다.'), injectId);
```

여러 구독자가 같은 통화를 다루는 구성이라면 [멀티 구독자 · 테넌트 격리](15-multi-subscriber-tenant-isolation.md) 를 참고하세요.

### 2.4 STT 수신 오디오 포맷 확인 (1:1 통화)

SDK 는 게이트웨이 오디오를 **16kHz** 로 받는다고 전제합니다(`AudioChunk.sampleRate` 는 항상 `16000`). SDK 의 STT 어댑터(`DeepgramAdapter` 등)에도 샘플레이트 옵션이 없고 16kHz 로 고정되어 있습니다.

- **16kHz, 16-bit PCM** (640 bytes/frame, 20ms) — 기본값, SDK 가 기대하는 포맷
- **8kHz, 16-bit PCM** (320 bytes/frame, 20ms) — 운영사가 8kHz(ulaw)로 설정한 경우. SDK 가 이 오디오를 16kHz 로 해석해 **2배속·고음**으로 인식되고 오인식이 늘어납니다.

어느 쪽인지는 받은 프레임 크기로 확인할 수 있습니다(`chunk.samples.length` 가 320 이면 16kHz, 160 이면 8kHz). 8kHz 라면 **운영사에 16kHz 로 바꿔 달라고 요청**하세요.

```typescript
// 첫 프레임 크기로 게이트웨이 오디오 포맷 확인
for await (const chunk of gw.streamAudio(linkedId, { dir: 'in' })) {
  console.log(`samples/frame=${chunk.samples.length} (320=16kHz, 160=8kHz)`);
  break;
}
```

### 2.5 STT 스트림 연결 확인 (1:1 통화)

STT 어댑터는 `gw.streamAudio()` 가 돌려준 스트림을 받아야 오디오를 받습니다. 스트림을 넘기지 않고 어댑터만 만들면 "인식 안됨" 증상이 나타납니다:

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const stt = new DeepgramAdapter({ apiKey: process.env['DEEPGRAM_API_KEY']!, language: 'ko' });
stt.onTranscript((r) => {
  if (r.isFinal) console.log(`[${r.speaker ?? '?'}] ${r.text}`);
});

// ✅ 통화 오디오 스트림을 STT 어댑터에 연결
const stream = gw.streamAudio(linkedId, { dir: 'both' });
await stt.startStream(linkedId, stream);
```

파이프라인 빌더(`gw.pipeline().stt(...)`)를 쓰면 이 연결은 SDK 가 알아서 합니다.

### 2.6 회의 STT 시작 확인

회의 STT(회의록)는 SDK 메서드가 아니라 **REST API** 로 시작합니다. STT 키는 요청에 넣지 않고, 게이트웨이에 등록된 테넌트 STT 키를 씁니다(키 등록은 대시보드 권한이 있으면 **API Keys → STT**, 없으면 운영사에 요청).

```bash
# 1) API 키로 JWT 발급
TOKEN=$(curl -s -X POST https://gw.example.com/api/v1/auth/token \
  -H "X-API-Key: $DV_API_KEY" | jq -r '.token')

# 2) 회의 STT 시작 (기본: 참여자별 per-participant 모드)
curl -s -X POST https://gw.example.com/api/v1/stt/conf/<confId>/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"provider":"deepgram","language":"ko"}'

# 3) 상태 확인 / 정지
curl -s https://gw.example.com/api/v1/stt/conf/<confId>/status -H "Authorization: Bearer $TOKEN"
curl -s -X POST https://gw.example.com/api/v1/stt/conf/<confId>/stop -H "Authorization: Bearer $TOKEN"
```

요청 본문(모두 선택):

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `provider` | 테넌트 기본 STT | 예: `deepgram` · `google` · `openai`. 비우면 테넌트에 기본으로 등록된 STT 를 씁니다(등록된 키가 없으면 400 `no STT provider configured`) |
| `language` | `ko` | 인식 언어 |
| `mix_only` | `false` | `true` 면 참여자별 대신 회의 믹스 1개 스트림으로 인식(비용 절감, 화자 구분 정확도↓) |
| `diarize` | `false` | 믹스 모드에서 AI 화자 구분 사용 |

시작 API 를 호출하지 않으면 회의 STT 가 시작되지 않습니다. 결과 회의록은 `gw.downloadMinutes(confId)` / `gw.download_minutes(conf_id)` 로 받습니다.

### 2.7 Python SDK 동일 패턴

```python
from dvgateway.adapters.stt import DeepgramAdapter

# thinking 시그널 — stop 을 먼저, 그다음 TTS
await gw.start_thinking(linked_id)
text = await ask_llm(user_text)          # (직접 구현한 LLM 호출)
await gw.stop_thinking(linked_id)
await gw.say(linked_id, text, tts)

# 직접 만든 16kHz PCM 주입 — inject_tts 는 async iterable 을 받습니다
async def once(pcm: bytes):
    yield pcm
await gw.inject_tts(linked_id, once(pcm16k))

# STT 스트림 연결
stt = DeepgramAdapter(api_key=os.environ["DEEPGRAM_API_KEY"], language="ko")
stt.on_transcript(lambda r: print(r.text) if r.is_final else None)
stream = gw.stream_audio(linked_id, dir="both")
await stt.start_stream(linked_id, stream)
```

회의 STT 시작은 언어와 관계없이 [2.6](#26-회의-stt-시작-확인) 의 REST API 를 씁니다.

---

## 3. 게이트웨이 설정이 음질에 미치는 영향

아래 항목은 게이트웨이 운영사(관리자)가 정합니다. 바꿔야 한다고 판단되면 운영사에 요청하세요.

| 항목 | 기본값 | 영향 |
|------|--------|------|
| 오디오 포맷 | 16kHz (slin16) | 8kHz(ulaw)로 설정되면 TTS 음질과 STT 정확도가 떨어집니다. 16kHz 권장 |
| 자동 음량 보정(AGC) | 켜짐 | 작은 입력을 키워 STT 인식률을 높입니다 (너무 민감하면 잡음도 커짐) |
| Comfort Noise | 운영사 설정 | 꺼져 있으면 thinking 시그널을 보내도 배경음이 나오지 않습니다 |
| Comfort Noise 크기 | 미묘한 배경음 수준 | 너무 크게 들리면 운영사에 낮춰 달라고 요청하세요 |

게이트웨이 버전은 `GET /api/v1/version` 으로 확인할 수 있습니다.

### 회의 STT 프로바이더 설정

회의(게이트웨이 내장) STT의 프로바이더 설정은 운영사가 조정합니다(대시보드 권한이 있다면 **API Keys → STT** 에서 조정 가능):

| 설정 | 기본값 | 영향 |
|------|--------|------|
| VAD Enabled | provider별 | 음성 활동 감지 on/off |
| VAD Silence Ms | provider별 (200~400) | 발화 종료 판단 기준 (짧을수록 빠름, 중간 끊김 위험) |
| Model | provider별 | STT 모델 (nova-3, chirp_3, gpt-4o-transcribe 등) |
| Endpointing Ms | provider별 | 발화 경계 감지 (짧을수록 빠른 응답, 문장 중간 끊김 위험) |
| Keywords | (없음) | 도메인 용어 부스팅 (정확도 향상, Deepgram 지원) |
| Sentiment | `false` | 감정 분석 활성화 (Deepgram Nova-3 전용) |

### 빠른 진단 체크리스트 (개발자 쪽)

```bash
# 1. 게이트웨이 버전 확인
curl -s https://gw.example.com/api/v1/version | jq .version

# 2. 회의 STT 상태 확인
curl -s https://gw.example.com/api/v1/stt/conf/<confId>/status -H "Authorization: Bearer <token>" | jq

# 3. Comfort Noise 사용 가능 여부 확인
curl -s https://gw.example.com/api/v1/comfort/status -H "Authorization: Bearer <token>" | jq
```

---

## 4. 일반적 원인과 해결책 — TTS

### 4.1 Comfort Noise ↔ TTS 전환 시 잡음

**증상:** TTS 시작 직후 200~300ms 동안 음성과 잡음이 번갈아 들림

**해결:**
- TTS 오디오를 보내기 **전에** `thinking:stop` 을 보내세요 ([2.2](#22-thinking-시그널-타이밍) 참고).
- 순서가 맞는데도 계속되면 운영사에 게이트웨이 버전 확인을 요청하세요(1.3.4 이상 필요).

### 4.2 AI TTS 서비스 지연 (끊김)

**증상:** TTS 재생 중 간헐적 무음/끊김

**원인:** AI TTS 서비스가 오디오를 제때 보내지 못해 게이트웨이가 그 사이를 무음으로 채웁니다.

**해결:**
1. AI TTS 서비스 리전 최적화 (한국 → `asia-northeast3` 등)
2. 서비스 프로바이더 변경 (레이턴시 비교)
3. 봇 서버의 네트워크 대역폭 점검
4. 반복되는 짧은 안내는 `CachedTtsAdapter` 로 캐시

### 4.3 샘플레이트 불일치

**증상:** 전체적 왜곡, 로봇 음성

**원인:** SDK가 8kHz 오디오를 전송하지만 게이트웨이가 16kHz 기대

**해결:**
- SDK TTS 어댑터는 이미 16kHz 로 출력합니다. **직접 만든 오디오**를 주입한다면 16kHz 16-bit mono raw PCM 으로 변환했는지 확인하세요([2.1](#21-tts-오디오-포맷-확인)).
- 게이트웨이 오디오 포맷이 16kHz인지 운영사에 확인

### 4.4 Click-to-Call TTS 시작 시 클릭 소리

**증상:** 아웃바운드 전화 응답 직후 TTS 시작 시 "딱" 소리

**원인:** 상대방 전화기 응답 후 미디어 경로가 아직 준비되지 않음

**해결:**
- 게이트웨이가 아웃바운드 통화에서 자동으로 짧은 준비 음(약 1초)을 먼저 보냅니다(게이트웨이 1.3.0+).
- 응답 직후 바로 말하지 말고 짧은 인사로 시작하면 체감이 줄어듭니다.
- 그래도 계속되면 운영사에 `linkedId` 와 시각을 보내 문의하세요.

### 4.5 회의 TTS 이중 재생

**증상:** 회의 공지가 두 번 재생됨

**해결:**
- 같은 공지를 두 번 보내지 않았는지(재시도 로직 포함) 확인하세요.
- 한 번만 보냈는데도 두 번 들리면 운영사에 `confId` 와 시각을 보내 문의하세요.

### 4.6 Comfort Noise 과도한 볼륨

**증상:** AI 처리 중 배경 잡음이 너무 큼

**해결:** 배경음 크기는 운영사가 정합니다. 운영사에 낮춰 달라고 요청하세요(또는 커스텀 배경음 파일 사용 — [Comfort Noise](08-comfort-noise.md) 참고).

---

## 5. 일반적 원인과 해결책 — STT

### 5.1 STT 인식 안됨 (1:1 통화)

**증상:** 사용자가 말해도 텍스트가 전혀 생성되지 않음

**점검 순서:**

1. **오디오 스트림 연결 확인** — `gw.streamAudio(linkedId)` 를 호출했는지, 401 등으로 거절되지 않았는지 확인하세요.
2. **오디오 프레임 수신 확인** — 스트림에서 PCM 프레임이 실제로 들어오는지 로그로 찍어 보세요. 프레임이 오는데 값이 전부 0에 가까우면 무음입니다.
3. **게이트웨이 오디오 포맷 확인** — SDK 는 16kHz 를 전제합니다. 8kHz 로 오고 있다면 운영사에 16kHz 로 바꿔 달라고 요청하세요([2.4](#24-stt-수신-오디오-포맷-확인-11-통화))
4. **SDK STT API 키 확인** — 프로바이더 대시보드에서 키 유효성 점검

프레임이 전혀 오지 않으면 운영사에 `linkedId` 와 시각을 보내 오디오 전달 여부 확인을 요청하세요.

### 5.2 STT 인식 안됨 (회의 — 게이트웨이 STT)

**증상:** 회의 시작 후 회의록이 생성되지 않음

**점검 순서:**

1. **STT 시작 API 호출 확인** — `POST /api/v1/stt/conf/{confId}/start` 응답이 성공인지, `GET /api/v1/stt/conf/{confId}/status` 로 상태를 확인하세요([2.6](#26-회의-stt-시작-확인)).
2. **STT 프로바이더 API 키 확인** — 테넌트에 등록된 STT 키가 유효한지 확인하세요(시작 응답이 400 `no STT provider configured` 면 키가 등록되지 않은 것입니다).
3. **프로바이더 상태 확인** — Deepgram/Google/OpenAI 상태 페이지 점검

상태가 정상인데 결과가 없으면 운영사에 `confId` 와 시각을 보내 문의하세요.

### 5.3 STT 인식 끊김 / 중간에 멈춤

**증상:** 처음에는 인식되다가 중간에 텍스트 출력이 멈춤

**원인별 대응:**

- **STT 연결 끊김:** 게이트웨이가 자동으로 재연결합니다. 짧은 공백 뒤 다시 결과가 나오면 정상입니다. 자주 반복되면 네트워크 또는 프로바이더 문제입니다.
- **자동 재연결 실패:** 회의 STT가 완전히 멈춥니다. API 키 만료, 프로바이더 장애, 할당량 초과가 주된 원인입니다. 키를 확인한 뒤 STT를 다시 시작하세요.
- **무발화 일시 중단:** 30초간 발화가 없으면 비용 절감을 위해 전달을 일시 중단하고, 음성이 감지되면 자동으로 재개합니다. 음성이 있는데도 재개되지 않으면 운영사에 문의하세요.

### 5.4 STT 오인식 / 정확도 저하

**증상:** 텍스트는 나오지만 내용이 부정확

**원인과 해결:**

| 원인 | 확인 방법 | 해결 |
|------|----------|------|
| 언어 설정 오류 | STT API 호출에서 `language` 파라미터 확인 | `ko` 또는 `ko-KR` 지정 |
| 모델 미스매치 | 어댑터·API 요청의 provider/model 확인 | Deepgram: `nova-3`, Google: `chirp_3` 권장 |
| 샘플레이트 불일치 | 게이트웨이 오디오 포맷 vs STT 설정 비교 | 양쪽 모두 16kHz 통일 |
| 저음량 입력 | 받은 PCM 프레임의 음량 확인 | 너무 작으면 운영사에 입력 음량 점검 요청 |
| 잡음 혼입 (Mix 모드) | TTS 재생 중 STT 결과 확인 | Per-participant 모드 전환 권장 |
| 도메인 용어 | 특수 용어(사명, 제품명) 오인식 | `keywords` 부스팅 설정 (Deepgram) |

### 5.5 TTS 음성 재인식 (에코 문제)

**증상:** AI TTS 응답이 STT에 재입력되어 무한 루프 또는 이상 인식 발생

**원인:** Mix 모드에서 TTS 오디오가 회의 믹스 스트림에 포함됨

**해결:**

1. **Per-participant 모드 사용 (권장)**
   ```bash
   # mix_only 를 넣지 않으면(기본 false) per-participant 모드로 시작합니다
   curl -s -X POST https://gw.example.com/api/v1/stt/conf/<confId>/start \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"provider":"deepgram","language":"ko"}'
   ```
   Per-participant 모드에서는 참여자별로 음성을 따로 받아 TTS 오디오가 섞이지 않습니다.

2. **Mix 모드의 자동 음소거**
   Mix 모드에서는 게이트웨이가 TTS 재생 중 STT를 자동으로 음소거합니다. 그런데도 AI 음성이 결과에 섞여 나오면 운영사에 `confId` 와 시각을 보내 문의하세요.

### 5.6 STT 비용 과다

**증상:** STT 프로바이더 청구 비용이 예상보다 높음

**원인과 해결:**

1. **세션 종료 확인** — 회의가 끝나면 STT를 정지하세요. 정리되지 않으면 비용이 계속 발생합니다.
2. **Per-participant 모드 vs Mix 모드**
   - Per-participant: 참여자 수 × STT 스트림 (정확하지만 비용 비례 증가)
   - Mix: 회의당 1개 STT 스트림 (비용 절감, diarization으로 화자 구분)
   - 비용이 중요한 경우 시작 요청에 `"mix_only": true` 사용
3. **VAD Silence 조정** — Silence 임계값을 줄이면 발화 구간 외 오디오 전송이 줄어 비용이 절감됩니다(회의 STT 설정, 운영사 조정).
4. 1:1 통화에서 SDK 자체 STT를 쓴다면 VAD 필터·`endpointingMs` 조정으로 비용을 줄일 수 있습니다([비용 절감](07-cost-optimization.md) 참고).

### 5.7 STT 응답 지연

**증상:** 말한 후 텍스트가 나오기까지 수초 소요

**원인과 해결:**

| 원인 | 확인 | 해결 |
|------|------|------|
| Endpointing 과대 | 어댑터 `endpointingMs` 또는 회의 STT 설정 확인 | Endpointing을 200~300ms로 줄임 |
| VAD Silence 과대 | 회의 STT 설정 확인 | 200~300ms로 줄임 (너무 짧으면 문장 중간 끊김) |
| 프로바이더 지연 | 다른 프로바이더로 테스트 | Deepgram이 보통 가장 빠름 |
| 네트워크 지연 | 봇 서버 ↔ 프로바이더 리전 거리 | 가까운 리전의 프로바이더 선택 |

### 5.8 회의 화자 구분 오류

**증상:** 회의에서 발화자가 잘못 표시되거나 구분이 안 됨

**모드별 특성:**

| | Per-participant 모드 | Mix 모드 + Diarization |
|---|---|---|
| 화자 식별 | 채널 기반 (100% 정확) | AI 기반 (음성 특징 분석) |
| 표시 | 전화번호/이름 | [A], [B], [C] 레이블 |
| 정확도 | 물리적 분리 → 완벽 | 유사한 목소리 시 혼동 가능 |
| 비용 | 참여자 수 비례 | 회의당 1 스트림 |
| 권장 | 정확한 화자 ID 필요 시 | 비용 절감이 우선일 때 |

**정확한 화자 식별이 필요하면 Per-participant 모드를 사용하세요.** Mix 모드의 diarization은 AI 기반이므로 유사한 목소리를 가진 참여자를 혼동할 수 있습니다.

---

## 6. 운영사에 문의할 때

### 개발자 쪽에서 먼저 해결할 수 있는 것

| 상황 | 운영사 문의 필요 | 먼저 할 것 |
|------|-----------------|-----------|
| TTS 끊김 (AI 서비스 지연) | 아니오 | 프로바이더·리전 변경, 캐시 |
| TTS 샘플레이트 불일치 | 아니오 | 직접 만든 오디오를 16kHz PCM 으로 변환했는지 확인 |
| Comfort noise ↔ TTS 잡음 | 순서가 맞으면 예 | thinking 시그널 순서 확인 |
| 아웃바운드 시작 클릭이 계속됨 | **예** | — |
| 회의 TTS 이중 재생 (한 번만 보냄) | **예** | 재시도 로직 확인 |
| STT API 키 오류 | 아니오 | 프로바이더 키 확인 |
| STT 수신 오디오가 8kHz | **예** | 프레임 크기 확인([2.4](#24-stt-수신-오디오-포맷-확인-11-통화)) |
| STT 재연결 반복 실패 | 키·프로바이더 확인 후 | 프로바이더 상태 페이지 확인 |
| 오디오 프레임이 오지 않음 / 전부 무음 | **예** | 스트림 연결·토큰 확인 |
| Mix 모드에서 AI 음성이 인식 결과에 섞임 | **예** | per-participant 모드 검토 |
| 무발화 일시 중단 뒤 재개 안 됨 | **예** | — |
| 재현 불가/간헐적 | 정보 수집 후 | 아래 정보를 모아 두기 |

### 문의 시 함께 보낼 정보

```
1. LinkedId / ConfId: (문제 세션)
2. 시각: (초 단위까지, 시간대 표기 — UTC 또는 KST)
3. 증상 유형: (섹션 1 표 참조)
4. 재현율: (매번 / 간헐적) 과 재현 방법
5. SDK 버전: (package.json 또는 pip show dvgateway)
6. 게이트웨이 버전: (GET /api/v1/version)
7. AI 프로바이더: (TTS: ElevenLabs/OpenAI/Google/Gemini, STT: Deepgram/Google/OpenAI)
8. Comfort Noise 사용 여부: (thinking 시그널 구현 여부)
9. STT 모드: (SDK 자체 / 회의 mix / 회의 per-participant)
10. 통화 유형: (인바운드 / 아웃바운드(click-to-call) / 회의)
11. 받은 오류: (HTTP 상태, 오류 코드, SDK 예외 메시지)
```
