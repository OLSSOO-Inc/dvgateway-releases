# 12. 통화 음질 문제 분석 및 대응 가이드 (TTS + STT)

SDK 사용자가 통화 중 음질 이상(TTS 재생 요동, STT 인식 불량, 끊김, 잡음)을 보고할 때의 체계적 분석 방법을 안내합니다.

---

## 목차

1. [증상별 분류](#1-증상별-분류)
2. [로그 수집 방법](#2-로그-수집-방법)
3. [게이트웨이 로그 분석 — TTS](#3-게이트웨이-로그-분석--tts)
4. [게이트웨이 로그 분석 — STT](#4-게이트웨이-로그-분석--stt)
5. [SDK 측 점검 사항](#5-sdk-측-점검-사항)
6. [환경변수 점검](#6-환경변수-점검)
7. [일반적 원인과 해결책 — TTS](#7-일반적-원인과-해결책--tts)
8. [일반적 원인과 해결책 — STT](#8-일반적-원인과-해결책--stt)
9. [에스컬레이션 기준](#9-에스컬레이션-기준)
10. [부록: 로그 키워드 빠른 참조](#부록-로그-키워드-빠른-참조)

---

## 1. 증상별 분류

### TTS (음성 재생) 문제

| 증상 | 설명 | 주요 원인 |
|------|------|-----------|
| **음질 요동** | 음성과 잡음이 번갈아 들림 | Comfort noise ↔ TTS 전환 중 프레임 인터리빙 |
| **간헐적 무음** | TTS 재생 중 짧은 끊김 발생 | AI TTS 서비스 지연 (underrun) |
| **볼륨 변동** | 전체 통화 음량이 불안정 | AGC 설정 과민, 또는 TTS 소스 볼륨 변동 |
| **시작 시 클릭/팝** | TTS 시작 직후 "딱" 소리 | Pre-roll 미적용, 미디어 브릿지 워밍업 부족 |
| **종료 시 클릭/팝** | TTS 끝날 때 "딱" 소리 | Fade-out 누락 |
| **에코/반복** | 같은 오디오가 이중 재생 | 회의 TTS 채널 이중 등록 (ttstx 문제) |
| **왜곡/노이즈** | 전체적으로 오디오 품질 저하 | 코덱 미스매치 (slin16 vs ulaw) |

### STT (음성 인식) 문제

| 증상 | 설명 | 주요 원인 |
|------|------|-----------|
| **인식 안됨** | 말해도 텍스트가 전혀 안 나옴 | STT 클라이언트 연결 실패, API 키 오류, 오디오 미전달 |
| **인식 끊김** | 처음엔 되다가 중간에 멈춤 | STT WebSocket 끊김 (자동 재연결 실패), idle 타임아웃 |
| **오인식/정확도 저하** | 텍스트가 나오지만 부정확 | 언어/모델 미스매치, 잡음 혼입, 샘플레이트 불일치 |
| **지연** | 말한 후 텍스트 출력까지 수초 소요 | STT 프로바이더 지연, endpointing 설정 과대 |
| **화자 구분 오류** | 회의에서 발화자가 잘못 표시 | diarization 한계, per-participant 모드 미사용 |
| **TTS 음성 재인식** | AI TTS 응답이 STT에 재입력됨 (에코) | Mix 모드에서 mute 미작동, per-participant 모드 미사용 |
| **비용 과다** | STT 비용이 예상보다 높음 | idle 감지 미작동, silence 구간에도 계속 전송 |

---

## 2. 로그 수집 방법

### 게이트웨이 로그 레벨 설정

```bash
# /etc/dvgateway/.env 에서 디버그 활성화
GW_LOG_LEVEL=debug
```

재시작 후 문제를 재현합니다.

### 필수 수집 로그

```bash
# TTS 관련 로그만 필터링
journalctl -u dvgateway --since "10 min ago" | grep -E "\[TTS|COMFORT|WS-AST\]"

# STT 관련 로그만 필터링
journalctl -u dvgateway --since "10 min ago" | grep -E "\[STT|STT-MGR|STT-ADAPTER\]"

# 전체 세션 로그 (linkedId 기준)
journalctl -u dvgateway --since "10 min ago" | grep "linkedid=<문제_linkedId>"

# 회의 세션 로그 (confId 기준)
journalctl -u dvgateway --since "10 min ago" | grep "conf=<문제_confId>"
```

### SDK 사용자에게 요청할 정보

1. **linkedId / confId** — 문제 발생한 통화 또는 회의의 ID
2. **시간대** — 문제 발생 시각 (초 단위까지)
3. **증상** — 위 표에서 어떤 유형인지
4. **재현율** — 매번인지, 간헐적인지
5. **사용 서비스** — TTS 프로바이더 / STT 프로바이더 (Deepgram, Google, OpenAI 등)
6. **SDK 버전** — `dvgateway-sdk` 또는 `dvgateway-adapters` 버전
7. **Comfort Noise 사용 여부** — thinking 시그널 구현 여부
8. **STT 모드** — 1:1 통화 (SDK 자체 STT) vs 회의 (클라우드 STT: mix / per-participant)
9. **통화 유형** — 인바운드 / 아웃바운드(click-to-call) / 회의(ConfBridge)

---

## 3. 게이트웨이 로그 분석 — TTS

### 3.1 정상 TTS 세션 로그 패턴

```
[TTS-WS] AI service connected linkedid=xxx
[TTS] media already active — skipping pre-roll, starting TTS playback
[TTS-WS] playback completed linkedid=xxx
```

### 3.2 Comfort Noise → TTS 전환 (정상)

v1.3.4+ 이후 정상 패턴:
```
[COMFORT] preempted by TTS — immediate stop (no fadeout)
[TTS-WS] AI service connected linkedid=xxx
[TTS] media already active — skipping pre-roll, starting TTS playback
```

v1.3.3 이하 문제 패턴 (인터리빙 발생):
```
[COMFORT] paused: TTS playback active
[TTS-WS] AI service connected linkedid=xxx
```
이 로그 조합이 나오면 comfort fadeOut(300ms)과 TTS fade-in(200ms)이 인터리빙되고 있습니다. **게이트웨이 업데이트가 필요합니다.**

### 3.3 Buffer Underrun (AI 서비스 지연)

```
[TTS] underrun recovered: 5 silence frames inserted (100ms gap)
```

이 로그는 AI TTS 서비스가 오디오 데이터를 제때 보내지 못해 게이트웨이가 무음 프레임을 삽입했음을 의미합니다.

**분석 포인트:**
- `silence frames` 수 × 20ms = 무음 시간
- 1~2프레임 (20~40ms): 정상 네트워크 지터, 체감 불가
- 3~5프레임 (60~100ms): 경미한 끊김, AI 서비스 지연 의심
- 10+ 프레임 (200ms+): 명확한 끊김, AI 서비스 또는 네트워크 문제

### 3.4 TTS 세션 통계

```
[TTS] playback stats: total_frames=350 underrun_frames=8
```

세션 종료 시 출력됩니다. `underrun_frames` 비율로 품질을 판단합니다:
- 0~1%: 우수
- 1~3%: 양호 (간헐적 마이크로 끊김)
- 3~10%: 주의 (체감 가능한 끊김)
- 10%+: 불량 (AI 서비스 또는 네트워크 점검 필요)

### 3.5 Pre-roll 관련

```
[TTS] media ready (waited 1500ms) — sending 50 pre-roll frames (1000ms)
[TTS] pre-roll complete — starting TTS playback
```

Click-to-call (아웃바운드) 통화에서만 나타납니다. media ready 대기가 30초를 초과하면 타임아웃됩니다.

```
[TTS] media already active — skipping pre-roll, starting TTS playback
```

인바운드 통화 또는 이미 오디오가 활성화된 세션에서는 pre-roll을 건너뜁니다. 정상입니다.

---

## 4. 게이트웨이 로그 분석 — STT

### 4.1 STT 아키텍처 이해

DVGateway의 STT는 두 가지 경로로 동작합니다:

| 경로 | 대상 | 처리 위치 | 로그 접두사 |
|------|------|-----------|------------|
| **SDK STT** | 1:1 통화 | SDK 측에서 직접 처리 (Deepgram/Google 등) | `[WS-DS]`, `[WS-AST]` |
| **클라우드 STT** | 회의 (ConfBridge) | 게이트웨이 내장 STT 매니저 | `[STT-MGR]`, `[STT-ADAPTER]` |

**1:1 통화 STT**: 게이트웨이는 오디오를 SDK 다운스트림 WebSocket으로 전달할 뿐, STT 자체는 SDK 측에서 처리합니다. 따라서 인식 정확도 문제는 대부분 SDK 측 이슈입니다. 게이트웨이에서는 **오디오 전달 여부**와 **오디오 품질**만 확인하면 됩니다.

**회의 STT**: 게이트웨이가 직접 클라우드 STT 프로바이더(Deepgram, Google, OpenAI 등)에 연결하여 참여자 음성을 인식합니다. Mix 모드와 Per-participant 모드가 있습니다.

### 4.2 1:1 통화 — 오디오 전달 확인

```bash
# 오디오 수신 확인 (Asterisk → Gateway)
journalctl -u dvgateway --since "10 min ago" | grep "first audio frame linkedid=<linkedId>"
```

정상 로그:
```
[WS-AST] first audio frame linkedid=xxx dir=both bytes=640 rms=0.0234
```

**rms 값 분석:**
- `rms=0.0000~0.0005`: 거의 무음 (마이크 음소거 또는 Asterisk 설정 문제)
- `rms=0.001~0.01`: 매우 조용함 (AGC가 보상하지만 SNR이 낮아 STT 정확도 저하)
- `rms=0.01~0.3`: 정상 범위
- `rms=0.3+`: 매우 큰 입력 (클리핑 가능성)

> **Click-to-Call (아웃바운드) 통화 주의:**
> 클릭투콜은 Local 채널을 사용하므로 다이얼플랜에서 **`[dvgateway-both-monitor]`** 컨텍스트를 호출해야 합니다 (인바운드 `[dvgateway-both]`와 다른 컨텍스트). 이 컨텍스트는 v1.3.7+에서 게이트웨이 시작 시 자동으로 `/etc/asterisk/dvgateway/extensions__10-dvgateway.conf`에 추가됩니다. 추가 후에는 `asterisk -rx 'dialplan reload'`만 실행하면 됩니다.
>
> Snoop은 Local 채널의 audiohook을 통해 양방향 오디오를 캡처하며, **별도의 `JITTERBUFFER`나 `AUDIOHOOK_INHERIT` 설정은 필요하지 않습니다.** 이전 버전에서 `Set(JITTERBUFFER(fixed)=default)` 워크어라운드를 사용했다면 v1.3.7+에서는 제거해도 됩니다.

```bash
# AI 클라이언트 연결 확인 (Gateway → SDK)
journalctl -u dvgateway --since "10 min ago" | grep "\[WS-DS\].*linkedid=<linkedId>"
```

정상 로그:
```
[WS-DS] AI client connected linkedid=xxx dir=both sub=abc-123
```

이 로그가 없으면 SDK가 오디오 스트림에 연결하지 않은 것입니다.

### 4.3 회의 STT — 클라우드 STT 세션 로그

#### 세션 시작

```
[STT-MGR] started per-participant STT for conf=100 provider=deepgram lang=ko participants=3
```
또는 (Mix 모드):
```
[STT-MGR] started mix STT for conf=100 provider=deepgram lang=ko diarize=true
```

이 로그가 없으면 STT가 시작되지 않은 것입니다. API 호출 확인이 필요합니다.

#### 오디오 전달 확인

```
[STT-MGR] mix audio forwarding conf=100 frames=1 bytes=640
[STT-MGR] mix audio forwarding conf=100 frames=500 bytes=640
```

또는 (Per-participant 모드):
```
[STT-MGR] participant audio forwarding conf=100 linked=xxx frames=1
[STT-MGR] participant audio forwarding conf=100 linked=xxx frames=500
```

- `frames=1` 로그: 첫 오디오 프레임 전달 확인
- `frames=500` 로그: 10초마다 출력 (500프레임 × 20ms = 10초)
- 프레임 카운트가 증가하지 않으면 오디오 파이프라인 문제

#### 인식 결과 출력

```
[STT-MGR] conf=100 speaker=01012345678 final=true text=안녕하세요 반갑습니다
```

- `final=true`: 확정된 인식 결과 (화면/회의록에 기록)
- `speaker=`: 발화자 식별 (per-participant 모드에서는 전화번호/이름, mix 모드에서는 [A], [B])
- `text=`: 인식된 텍스트

#### STT 클라이언트 건강 상태

```
[STT-MGR] STT client unhealthy conf=100 — reconnecting
[STT-MGR] reconnected STT client conf=100 provider=deepgram
```

STT 프로바이더 WebSocket 연결이 끊기면 자동 재연결합니다. 이 로그가 빈번하면 네트워크 불안정 또는 API 키 문제입니다.

```
[STT-MGR] STT reconnect failed conf=100 — stopping
```

**재연결 실패**: STT가 완전히 중단됩니다. API 키 만료, 프로바이더 장애, 또는 네트워크 문제입니다.

#### Idle 감지 (비용 절감)

```
[STT-MGR] idle pause conf=100 (no speech for 30s, saving STT cost)
[STT-MGR] auto-resumed from idle conf=100 (audio energy detected)
```

30초간 발화가 없으면 오디오 전달을 일시 중단하여 STT 비용을 절약합니다. 음성이 감지되면 자동 재개됩니다. 정상 동작입니다.

#### Mute (TTS 피드백 방지)

```
[STT-MGR] muted conf=100 (TTS playback — mix mode)
[STT-MGR] unmuted conf=100 (TTS playback ended — mix mode)
```

Mix 모드에서만 해당합니다. TTS 재생 중 AI 음성이 STT에 재입력되는 것을 방지합니다. Per-participant 모드에서는 Snoop 채널이 물리적으로 오디오 방향을 분리하므로 mute가 불필요합니다.

#### 프레임 드롭 (STT-ADAPTER)

```
[STT-ADAPTER] frame drop (target slow) confID=100 linkedID=xxx subID=stt-part-xxx total_dropped=50
[STT-ADAPTER] recovered after 50 dropped frames confID=100 linkedID=xxx
```

오디오 채널 버퍼가 가득 차서 프레임이 버려지고 있습니다. STT 프로바이더가 오디오를 소비하는 속도가 느리거나 네트워크 병목입니다.

---

## 5. SDK 측 점검 사항

### 5.1 TTS 오디오 포맷 확인

게이트웨이가 수신하는 TTS PCM 포맷은 반드시:
- **16kHz, 16-bit, Signed Linear PCM, mono, little-endian**
- 프레임 크기: 640 bytes (16kHz × 20ms × 2 bytes)

잘못된 포맷으로 전송 시 왜곡 발생:

```typescript
// ❌ 잘못된 예: 8kHz 오디오를 그대로 전송
ttsStream.write(audio8kHz); // 왜곡 발생

// ✅ 올바른 예: 16kHz PCM 전송
ttsStream.write(audio16kHz);
```

### 5.2 Thinking 시그널 타이밍

```typescript
// ✅ 올바른 순서: thinking:stop → TTS 데이터 전송
pipeline.on('llm:complete', async (text) => {
  stream.send({ type: 'thinking:stop' });  // comfort noise 중단
  const audio = await tts.synthesize(text);
  ttsStream.write(audio);                   // TTS 재생 시작
});
```

```typescript
// ❌ 잘못된 순서: TTS 전송 후 thinking:stop
ttsStream.write(audio);
stream.send({ type: 'thinking:stop' }); // 너무 늦음
```

### 5.3 동시 TTS 세션 방지

```typescript
// ❌ 잘못된 예: 이전 TTS 재생 중 새 TTS 시작
async function speak(text) {
  const audio = await tts.synthesize(text);
  ttsStream.write(audio); // 이전 세션과 겹침 가능
}

// ✅ 올바른 예: 이전 TTS 중단 후 새 TTS 시작
async function speak(text) {
  ttsStream.send({ cmd: 'interrupt' }); // 기존 TTS 즉시 중단
  const audio = await tts.synthesize(text);
  ttsStream.write(audio);
}
```

### 5.4 STT 수신 오디오 포맷 확인 (1:1 통화)

게이트웨이가 SDK로 전달하는 오디오:
- `GW_AUDIO_FORMAT=slin16`: **16kHz, 16-bit PCM** (640 bytes/frame, 20ms)
- `GW_AUDIO_FORMAT=ulaw`: **8kHz, 16-bit PCM** (decoded, 320 bytes/frame, 20ms)

SDK의 STT 어댑터 sampleRate가 게이트웨이 출력과 일치해야 합니다:

```typescript
// ✅ slin16 모드일 때 (기본값, 권장)
const stt = new DeepgramSTTAdapter({
  sampleRate: 16000,  // 게이트웨이 출력과 일치
  encoding: 'linear16',
  language: 'ko',
});

// ❌ slin16 모드인데 8000으로 설정하면 2배속/고음으로 인식
const stt = new DeepgramSTTAdapter({
  sampleRate: 8000,   // 불일치 → 오인식
});
```

```python
# ✅ Python SDK 동일
stt = DeepgramSTTAdapter(
    sample_rate=16000,
    encoding="linear16",
    language="ko",
)
```

### 5.5 STT 스트림 연결 확인 (1:1 통화)

SDK가 오디오 스트림을 수신하려면 반드시 연결해야 합니다:

```typescript
// ✅ 오디오 스트림 구독
const stream = await client.streams.connect(linkedId, { dir: 'both' });

// 오디오 데이터 수신 이벤트
stream.on('audio', (pcmData: Buffer) => {
  sttAdapter.sendAudio(pcmData);
});
```

스트림 연결 없이 STT를 초기화하면 "인식 안됨" 증상이 나타납니다.

### 5.6 회의 STT API 호출 확인

회의 STT는 별도 API 호출이 필요합니다:

```typescript
// ✅ 회의 STT 시작 (per-participant 모드)
await client.post(`/api/v1/stt/conf/${confId}`, {
  provider: 'deepgram',
  apiKey: process.env.DEEPGRAM_API_KEY,
  language: 'ko',
});
```

API를 호출하지 않으면 게이트웨이 STT 매니저가 시작되지 않습니다.

### 5.7 Python SDK 동일 패턴

```python
# TTS thinking 시그널
async def on_llm_complete(text: str):
    stream.send({"type": "thinking:stop"})
    audio = await tts.synthesize(text)
    tts_stream.write(audio)

# STT 스트림 연결
stream = await client.streams.connect(linked_id, dir="both")
stream.on("audio", lambda pcm: stt_adapter.send_audio(pcm))

# 회의 STT 시작
await client.post(f"/api/v1/stt/conf/{conf_id}", {
    "provider": "deepgram",
    "apiKey": deepgram_key,
    "language": "ko",
})
```

---

## 6. 환경변수 점검

### TTS 음질에 영향을 주는 설정

| 변수 | 기본값 | 음질 영향 |
|------|--------|-----------|
| `GW_AUDIO_FORMAT` | `slin16` | `ulaw`은 8kHz 다운샘플링 → 음질 저하. `slin16` 권장 |
| `GW_AGC_THRESHOLD` | `0.05` | 낮은 값은 AGC가 더 자주 작동 → 수신 오디오 볼륨 변동 (TTS에는 직접 영향 없음) |
| `GW_COMFORT_NOISE_ENABLED` | `true` | `false`로 설정 시 comfort noise 완전 비활성화 |
| `GW_COMFORT_NOISE_LEVEL` | `-50` | dBFS 값. -60에 가까울수록 조용함. -40에 가까울수록 큼 |

### STT 품질에 영향을 주는 설정

| 변수 | 기본값 | STT 영향 |
|------|--------|----------|
| `GW_AUDIO_FORMAT` | `slin16` | `slin16`(16kHz) → STT 정확도 최적. `ulaw`(8kHz) → 정확도 저하 |
| `GW_AGC_THRESHOLD` | `0.05` | AGC가 저음량 입력을 증폭하여 STT 인식률 향상 (너무 낮으면 노이즈도 증폭) |
| `GW_STREAM_MODE` | `both` | `separated` 모드에서는 in/out 방향별 별도 스트림 가능 |

### 회의 STT 전용 설정 (API keys 대시보드)

대시보드 → API Keys → STT 프로바이더 설정에서 조정 가능:

| 설정 | 기본값 | 영향 |
|------|--------|------|
| VAD Enabled | provider별 | 음성 활동 감지 on/off |
| VAD Silence Ms | provider별 (200~400) | 발화 종료 판단 기준 (짧을수록 빠름, 중간 끊김 위험) |
| Model | provider별 | STT 모델 (nova-3, chirp_3, gpt-4o-transcribe 등) |
| Endpointing Ms | provider별 | 발화 경계 감지 (짧을수록 빠른 응답, 문장 중간 끊김 위험) |
| Keywords | (없음) | 도메인 용어 부스팅 (정확도 향상, Deepgram 지원) |
| Sentiment | `false` | 감정 분석 활성화 (Deepgram Nova-3 전용) |

### 빠른 진단 체크리스트

```bash
# 1. 오디오 포맷 확인
grep GW_AUDIO_FORMAT /etc/dvgateway/.env
# 기대값: slin16

# 2. Comfort noise 설정 확인
grep GW_COMFORT_NOISE /etc/dvgateway/.env

# 3. 게이트웨이 버전 확인
dvgateway --version
# 또는
curl -s http://localhost:8080/api/v1/version | jq .version

# 4. 실시간 TTS 세션 모니터링
journalctl -u dvgateway -f | grep -E "\[TTS|COMFORT\]"

# 5. 실시간 STT 세션 모니터링
journalctl -u dvgateway -f | grep -E "\[STT-MGR|STT-ADAPTER\]"

# 6. 회의 STT 상태 확인
curl -s http://localhost:8080/api/v1/stt/conf/<confId> -H "Authorization: Bearer <token>" | jq
```

---

## 7. 일반적 원인과 해결책 — TTS

### 7.1 Comfort Noise ↔ TTS 인터리빙 (v1.3.3 이하)

**증상:** TTS 시작 직후 200~300ms 동안 음성과 잡음이 번갈아 들림

**원인:** Comfort noise fadeOut(300ms)이 TTS fade-in(200ms)과 동시에 같은 WebSocket에 프레임을 씀

**해결:** 게이트웨이를 v1.3.4+로 업데이트
```bash
dvgateway-update.sh
```

### 7.2 AI TTS 서비스 지연 (Buffer Underrun)

**증상:** TTS 재생 중 간헐적 무음/끊김

**원인:** AI TTS 서비스의 오디오 스트리밍 지연으로 200ms 버퍼 소진

**해결:**
1. AI TTS 서비스 리전 최적화 (한국 → `asia-northeast3` 등)
2. 서비스 프로바이더 변경 (레이턴시 비교)
3. 서버 네트워크 대역폭 점검
4. 로그에서 `underrun recovered` 빈도 확인

### 7.3 코덱 미스매치

**증상:** 전체적 왜곡, 로봇 음성

**원인:** SDK가 8kHz 오디오를 전송하지만 게이트웨이가 16kHz 기대

**해결:**
- SDK TTS 어댑터 설정에서 `sampleRate: 16000` 확인
- `GW_AUDIO_FORMAT=slin16` 확인

### 7.4 Click-to-Call TTS 시작 시 클릭 소리

**증상:** 아웃바운드 전화 응답 직후 TTS 시작 시 "딱" 소리

**원인:** 상대방 전화기 응답 후 미디어 경로 워밍업 미완료

**해결:**
- 게이트웨이가 자동으로 pre-roll noise(1초)를 전송함 (v1.3.0+)
- 로그에서 `media ready (waited Xms)` 확인
- 대기 시간이 30초 초과 시 네트워크 문제

### 7.5 회의 TTS 이중 재생

**증상:** 회의 공지가 두 번 재생됨

**원인:** confmix 채널과 ttstx 채널 모두 TTS Hub에 등록

**해결:** 게이트웨이 코드 점검 필요 (ttstx 전용 채널만 confMembers에 등록)

### 7.6 Comfort Noise 과도한 볼륨

**증상:** AI 처리 중 배경 잡음이 너무 큼

**해결:**
```bash
# .env 에서 노이즈 레벨 조정 (기본 -50, 범위 -60 ~ -40)
GW_COMFORT_NOISE_LEVEL=-55   # 더 조용하게

# 또는 커스텀 오디오 파일 사용
GW_COMFORT_NOISE_FILE=/etc/dvgateway/ambient.pcm
```

---

## 8. 일반적 원인과 해결책 — STT

### 8.1 STT 인식 안됨 (1:1 통화)

**증상:** 사용자가 말해도 텍스트가 전혀 생성되지 않음

**점검 순서:**

1. **오디오 스트림 연결 확인**
   ```bash
   journalctl -u dvgateway | grep "\[WS-DS\].*linkedid=<ID>"
   # "[WS-DS] AI client connected" 로그가 있어야 함
   ```

2. **오디오 프레임 수신 확인**
   ```bash
   journalctl -u dvgateway | grep "first audio frame linkedid=<ID>"
   # rms > 0.001 이어야 음성 존재
   ```

3. **SDK STT 어댑터 sampleRate 확인** — `GW_AUDIO_FORMAT`과 일치해야 함

4. **SDK STT API 키 확인** — 프로바이더 대시보드에서 키 유효성 점검

### 8.2 STT 인식 안됨 (회의 — 클라우드 STT)

**증상:** 회의 시작 후 회의록이 생성되지 않음

**점검 순서:**

1. **STT 시작 API 호출 확인**
   ```bash
   journalctl -u dvgateway | grep "\[STT-MGR\] started.*conf=<confId>"
   # 로그가 없으면 API가 호출되지 않은 것
   ```

2. **STT 프로바이더 API 키 확인**
   ```bash
   journalctl -u dvgateway | grep "\[STT-MGR\].*failed.*conf=<confId>"
   # "start failed" 또는 "reconnect failed" 확인
   ```

3. **오디오 전달 확인**
   ```bash
   journalctl -u dvgateway | grep "\[STT-MGR\].*forwarding.*conf=<confId>"
   # frames=1 이상이어야 오디오가 STT로 전달되고 있음
   ```

4. **프로바이더 상태 확인** — Deepgram/Google/OpenAI 상태 페이지 점검

### 8.3 STT 인식 끊김 / 중간에 멈춤

**증상:** 처음에는 인식되다가 중간에 텍스트 출력이 멈춤

**원인별 대응:**

**A) STT 클라이언트 연결 끊김:**
```
[STT-MGR] STT client disconnected conf=100 after 1500 frames — reconnecting
[STT-MGR] reconnected STT client conf=100 provider=deepgram
```
자동 재연결이 성공하면 정상입니다. 빈번하면 네트워크 불안정입니다.

**B) 자동 재연결 실패:**
```
[STT-MGR] STT reconnect failed conf=100 — stopping
```
STT가 완전히 중단됩니다. API 키 만료, 프로바이더 장애, 또는 할당량 초과입니다.

**C) Idle 타임아웃:**
```
[STT-MGR] idle pause conf=100 (no speech for 30s, saving STT cost)
```
30초간 무발화 시 정상적으로 일시 중단됩니다. 음성이 감지되면 자동 재개됩니다. 만약 음성이 있는데도 idle 상태가 유지되면 `audioHasEnergy` 임계값 문제일 수 있습니다.

**D) Health check 실패:**
```
[STT-MGR] STT client unhealthy conf=100 — reconnecting
```
오디오를 250+ 프레임(5초) 이상 보냈는데 20초간 결과가 없으면 비정상으로 판단합니다.

### 8.4 STT 오인식 / 정확도 저하

**증상:** 텍스트는 나오지만 내용이 부정확

**원인과 해결:**

| 원인 | 확인 방법 | 해결 |
|------|----------|------|
| 언어 설정 오류 | STT API 호출에서 `language` 파라미터 확인 | `ko` 또는 `ko-KR` 지정 |
| 모델 미스매치 | 로그에서 provider/model 확인 | Deepgram: `nova-3`, Google: `chirp_3` 권장 |
| 샘플레이트 불일치 | `GW_AUDIO_FORMAT` vs STT 설정 비교 | 양쪽 모두 16kHz 통일 |
| 저음량 입력 | `first audio frame rms` 값 확인 | rms < 0.01이면 Asterisk AGC 또는 볼륨 점검 |
| 잡음 혼입 (Mix 모드) | TTS 재생 중 STT mute 확인 | Per-participant 모드 전환 권장 |
| 도메인 용어 | 특수 용어(사명, 제품명) 오인식 | `keywords` 부스팅 설정 (Deepgram) |

### 8.5 TTS 음성 재인식 (에코 문제)

**증상:** AI TTS 응답이 STT에 재입력되어 무한 루프 또는 이상 인식 발생

**원인:** Mix 모드에서 TTS 오디오가 ConfBridge 믹스 스트림에 포함됨

**해결:**

1. **Per-participant 모드 사용 (권장)**
   ```typescript
   await client.post(`/api/v1/stt/conf/${confId}`, {
     provider: 'deepgram',
     apiKey: key,
     language: 'ko',
     // mixOnly: false (기본값) → per-participant 모드 자동 선택
   });
   ```
   Per-participant 모드에서는 Snoop(spy=in) 채널이 참여자 음성만 캡처하여 TTS 오디오가 물리적으로 분리됩니다.

2. **Mix 모드에서 Mute 확인**
   Mix 모드 사용 시 게이트웨이가 TTS 재생 중 자동으로 STT를 mute합니다:
   ```
   [STT-MGR] muted conf=100 (TTS playback — mix mode)
   [STT-MGR] unmuted conf=100 (TTS playback ended — mix mode)
   ```
   이 로그가 없으면 mute가 작동하지 않는 것입니다.

### 8.6 STT 비용 과다

**증상:** STT 프로바이더 청구 비용이 예상보다 높음

**원인과 해결:**

1. **Idle 감지 확인**
   ```bash
   journalctl -u dvgateway | grep "idle pause\|auto-resumed" | tail -20
   ```
   idle pause 로그가 없으면 무발화 구간에서도 계속 오디오를 전송하고 있습니다.

2. **세션 종료 확인**
   ```bash
   journalctl -u dvgateway | grep "\[STT-MGR\] stopped.*conf="
   ```
   회의 종료 후 STT 세션이 정리되지 않으면 비용이 계속 발생합니다.

3. **Per-participant 모드 vs Mix 모드**
   - Per-participant: 참여자 수 × STT 스트림 (정확하지만 비용 비례 증가)
   - Mix: 회의당 1개 STT 스트림 (비용 절감, diarization으로 화자 구분)
   - 비용이 중요한 경우 `mixOnly: true` 옵션 사용

4. **VAD Silence 조정**
   Silence 임계값을 줄이면 발화 구간 외 오디오 전송이 줄어 비용 절감:
   ```
   대시보드 → API Keys → STT → VAD Silence Ms: 200 (기본 300~400)
   ```

### 8.7 STT 응답 지연

**증상:** 말한 후 텍스트가 나오기까지 수초 소요

**원인과 해결:**

| 원인 | 확인 | 해결 |
|------|------|------|
| Endpointing 과대 | 대시보드 STT 설정 확인 | Endpointing을 200~300ms로 줄임 |
| VAD Silence 과대 | 대시보드 STT 설정 확인 | 200~300ms로 줄임 (너무 짧으면 문장 중간 끊김) |
| 프로바이더 지연 | 다른 프로바이더로 테스트 | Deepgram이 보통 가장 빠름 |
| 네트워크 지연 | 서버 ↔ 프로바이더 리전 거리 | 가까운 리전의 프로바이더 선택 |

### 8.8 회의 화자 구분 오류

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

## 9. 에스컬레이션 기준

### SDK 사용자 대응 → 게이트웨이 팀 에스컬레이션이 필요한 경우

| 상황 | 에스컬레이션 | 근거 |
|------|-------------|------|
| TTS underrun 로그 다수 | 아니오 | AI 서비스/네트워크 문제 — SDK 사용자측 해결 |
| TTS 코덱 미스매치 | 아니오 | SDK 사용자 설정 오류 |
| v1.3.3 이하 인터리빙 | 아니오 | 업데이트 안내 |
| v1.3.4+ 에서도 인터리빙 | **예** | 게이트웨이 버그 가능 |
| pre-roll 후에도 클릭 | **예** | 게이트웨이 코드 점검 필요 |
| 회의 TTS 이중 재생 | **예** | TTS Hub 등록 로직 점검 필요 |
| STT API 키 오류 | 아니오 | SDK 사용자측 키 관리 |
| STT sampleRate 불일치 | 아니오 | SDK 사용자 설정 오류 |
| STT 자동 재연결 반복 실패 | 로그 수집 후 판단 | 네트워크 또는 프로바이더 문제 우선 배제 |
| 오디오 프레임 전달 안됨 (rms=0) | **예** | Asterisk/게이트웨이 오디오 파이프라인 점검 |
| STT mute/unmute 미작동 | **예** | 게이트웨이 TTS ↔ STT 연동 점검 |
| idle 후 자동 재개 안됨 | **예** | audioHasEnergy 임계값 점검 |
| 프레임 드롭 지속 발생 | **예** | 게이트웨이 내부 버퍼/성능 점검 |
| 재현 불가/간헐적 | 로그 수집 후 판단 | 로그 없으면 분석 불가 |

### 에스컬레이션 시 포함할 정보

```
1. 게이트웨이 버전: (dvgateway --version)
2. LinkedId / ConfId: (문제 세션)
3. 시간대: (UTC 또는 KST)
4. 로그: (journalctl 출력)
   - TTS 문제: [TTS], [COMFORT], [WS-AST] 필터
   - STT 문제: [STT-MGR], [STT-ADAPTER], [WS-AST], [WS-DS] 필터
5. 증상 유형: (섹션 1 표 참조)
6. 재현 방법: (가능한 경우)
7. SDK 버전: (package.json 또는 pip show)
8. AI 프로바이더: (TTS: ElevenLabs/OpenAI/Google/Gemini, STT: Deepgram/Google/OpenAI)
9. Comfort Noise 설정: (enabled/level)
10. STT 모드: (SDK 자체 / 클라우드 mix / 클라우드 per-participant)
11. 통화 유형: (인바운드 / 아웃바운드 / 회의)
```

---

## 부록: 로그 키워드 빠른 참조

### TTS 로그

| 로그 키워드 | 의미 |
|------------|------|
| `[TTS-WS] AI service connected` | SDK TTS WebSocket 연결됨 |
| `[TTS] media ready (waited Xms)` | 미디어 브릿지 워밍업 완료 (click-to-call) |
| `[TTS] media already active` | 인바운드 — 즉시 TTS 시작 |
| `[TTS] pre-roll complete` | 워밍업 noise 전송 완료 |
| `[TTS] underrun recovered: N frames` | AI 서비스 지연으로 무음 N프레임 삽입 후 복구 |
| `[TTS] playback stats: total=X underrun=Y` | 세션 종료 시 통계 |
| `[TTS-WS] playback completed` | TTS 재생 정상 완료 |
| `[COMFORT] preempted by TTS` | TTS 시작으로 comfort noise 즉시 중단 (정상) |
| `[COMFORT] fadeout aborted: TTS playback started` | fadeOut 중 TTS 시작으로 중단 (정상) |
| `[COMFORT] auto-start after TTS end` | TTS 종료 후 comfort noise 자동 시작 |
| `[COMFORT] thinking:start` | SDK thinking 시그널로 comfort 시작 |
| `[COMFORT] thinking:stop` | SDK thinking 시그널로 comfort 중단 |

### STT 로그

| 로그 키워드 | 의미 |
|------------|------|
| `[STT-MGR] started per-participant STT` | 참여자별 STT 시작 |
| `[STT-MGR] started mix STT` | 믹스 오디오 STT 시작 |
| `[STT-MGR] mix audio forwarding frames=N` | 믹스 오디오 전달 중 (N프레임) |
| `[STT-MGR] participant audio forwarding` | 참여자 오디오 전달 중 |
| `[STT-MGR] conf=X speaker=Y text=Z` | STT 인식 결과 (final) |
| `[STT-MGR] STT client unhealthy` | STT 연결 비정상 → 재연결 시도 |
| `[STT-MGR] reconnected STT client` | STT 재연결 성공 |
| `[STT-MGR] STT reconnect failed — stopping` | STT 재연결 실패 → 세션 중단 |
| `[STT-MGR] idle pause` | 30초 무발화 → 비용 절감 일시 중단 |
| `[STT-MGR] auto-resumed from idle` | 음성 감지 → 자동 재개 |
| `[STT-MGR] muted conf=X` | TTS 재생 중 STT 음소거 (mix 모드) |
| `[STT-MGR] unmuted conf=X` | TTS 종료 → STT 음소거 해제 |
| `[STT-MGR] mute skipped (per-participant)` | Per-participant 모드 → mute 불필요 |
| `[STT-MGR] stopped cloud STT` | 회의 STT 세션 종료 |
| `[STT-ADAPTER] frame drop (target slow)` | 오디오 버퍼 초과 → 프레임 드롭 |
| `[STT-ADAPTER] recovered after N dropped` | 프레임 드롭 후 정상 복구 |

### 오디오 파이프라인 로그

| 로그 키워드 | 의미 |
|------------|------|
| `[WS-AST] connected linkedid=X` | Asterisk 오디오 WebSocket 연결됨 |
| `[WS-AST] first audio frame` | 첫 오디오 프레임 수신 (rms 값 확인) |
| `[WS-AST] processAudioStream ended` | 오디오 스트림 종료 (프레임 수 표시) |
| `[WS-DS] AI client connected` | SDK 다운스트림 WebSocket 연결됨 |
| `[WS-DS] send error` | SDK로 오디오 전송 실패 |
| `[WS-DS] tenant mismatch — rejected` | 테넌트 격리 위반 → 403 차단 |

---

_최종 업데이트: 2026-04-04_
