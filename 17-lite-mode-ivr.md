# 17. 최소 비용 IVR 봇 만들기 (`mode=lite`)

> **요약** — 안내 멘트 + 번호(DTMF) 입력만 받으면 되는 통화에는 `mode=lite` Stasis 프로파일이 **표준 패턴**입니다. STT/LLM/TTS 어댑터·실시간 PCM 스트림이 전부 빠지고 ARI Playback API + AMI DTMF 이벤트만 사용해, 통화당 메모리·CPU를 **수 KB / 수 µs 단위**로 끌어내릴 수 있습니다.
>
> Gateway 1.4.3+ / SDK 1.7.0+ 부터 지원. 라이선스 동시통화 카운터·CDR·테넌트 격리·대시보드는 일반 모드와 동일합니다.

---

## 1. 언제 `lite` 모드를 써야 하는가

| 통화 유형 | 권장 모드 | 이유 |
|-----------|-----------|------|
| 단순 안내 멘트 (영업시간 안내 등) | **lite** | 음성 인식 불필요 |
| 번호 입력 메뉴 ("1번 영업, 2번 기술지원") | **lite** | DTMF만 받으면 됨 |
| 본인 인증 PIN 입력 후 음성 안내 | **lite** | 사운드 파일 + DTMF 조합 |
| 통화 녹음 동의 확인 (* 또는 1 입력) | **lite** | 짧은 안내 + 1자리 DTMF |
| 콜백 예약 (시간대 번호 선택) | **lite** | 메뉴 + DTMF |
| AI 상담 / 대화형 봇 | full (`both`) | STT/LLM/TTS 필요 |
| 회의록 자동 생성 | full | STT 필요 |
| 콜센터 상담원 실시간 보조 | `role=monitor` | 음성 캡처 + 분석 필요 |

**판단 기준 한 줄**: "고객의 **말**을 들어야 하나, **번호 입력**만 받으면 되나?" 후자라면 lite.

---

## 2. 리소스 절감 효과 (대략)

`lite` 모드는 통화당 다음 자원을 **사용하지 않습니다**:

- ExternalMedia (chan_websocket) goroutine
- Snoop audiohook (PBX 측 framehook)
- Mixing bridge 1개
- STT 세션 (제공자 연결 + 오디오 버퍼)
- Downstream WebSocket fan-out (4096 슬롯 채널)
- AGC / RMS / VAD 처리 루프
- 오디오 PCM 버퍼 (~4 KB)

또한 **STT 호출이 0건**이고, 사운드 파일 (`sound:`/`number:`/`digits:`/`tone:`)만 쓰는 IVR이라면 **TTS 호출도 0건**입니다. 동적 TTS가 필요하면 `liteTtsPlayback()` 으로 추가 가능하며, 같은 문장은 게이트웨이 캐시 적중으로 1회만 합성하므로 cloud TTS 호출 비용도 호출당이 아니라 **문장당**으로 떨어집니다.

---

## 3. SDK 표준 패턴

### 3.1 다이얼플랜 (PBX 측)

```ini
; /etc/asterisk/extensions.conf
[from-trunk]
exten => _8X.,1,NoOp(단순 IVR — lite 모드)
 same => n,Set(DID=${EXTEN})
 same => n,Stasis(dvgateway,\
     mode=lite,\
     did=${DID},\
     callid=${UNIQUEID},\
     callernum=${CALLERID(num)},\
     callednum=${EXTEN},\
     tenantid=${TENANTID},\
     timestamp=${EPOCH()})
 same => n,Hangup()
```

핵심은 `mode=lite` 한 줄. 나머지는 일반 Stasis 호출과 동일합니다.

### 3.2 TypeScript 표준 패턴

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: process.env.DV_GATEWAY_URL!,
  auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY! },
});

gw.onCallEvent(async (evt) => {
  // ── 1) lite 통화만 처리 ────────────────────────────
  if (evt.type !== 'call:new' || evt.session.mode !== 'lite') return;

  const { linkedId } = evt.session;
  try {
    // ── 2) 안내 멘트 ────────────────────────────────
    await gw.playback({ linkedId, media: 'sound:welcome' });

    // ── 3) DTMF 메뉴 수집 ────────────────────────────
    const res = await gw.collectDtmf({
      linkedId,
      maxDigits: 1,
      timeoutMs: 8_000,
      interDigitTimeoutMs: 3_000,
    });

    // ── 4) 분기 처리 ────────────────────────────────
    switch (res.digits) {
      case '1':
        await gw.playback({ linkedId, media: 'sound:queue-thankyou' });
        // 상담원 큐로 전환은 redirect API로 (아래 4.3 참조)
        await gw.redirect(linkedId, { context: 'queue-sales', exten: 's' });
        return;
      case '2':
        await gw.playback({ linkedId, media: 'sound:office-hours' });
        break;
      default:
        await gw.playback({ linkedId, media: 'sound:invalid-key' });
    }
  } finally {
    // ── 5) 종료 ────────────────────────────────────
    await gw.hangup(linkedId);
  }
});

console.log('lite-ivr ready');
await new Promise(() => {}); // run forever
```

### 3.3 Python 표준 패턴

```python
import asyncio
import os
from dvgateway import DVGatewayClient

async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.environ["DV_GATEWAY_URL"],
        auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
    )

    async def on_call(evt) -> None:
        if evt.type != "call:new" or evt.session.mode != "lite":
            return

        lid = evt.session.linked_id
        try:
            await gw.playback(lid, media="sound:welcome")

            res = await gw.collect_dtmf(
                lid,
                max_digits=1,
                timeout_ms=8_000,
                inter_digit_timeout_ms=3_000,
            )

            if res.digits == "1":
                await gw.playback(lid, media="sound:queue-thankyou")
                await gw.redirect(lid, context="queue-sales", exten="s")
                return
            elif res.digits == "2":
                await gw.playback(lid, media="sound:office-hours")
            else:
                await gw.playback(lid, media="sound:invalid-key")
        finally:
            await gw.hangup(lid)

    gw.on_call_event(on_call)
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 4. 구성 요소 레퍼런스

### 4.1 `playback({ linkedId, media })`

| `media` 형식 | 예시 | 결과 |
|--------------|------|------|
| `sound:<filename>` | `sound:welcome` | `sounds/{lang}/welcome.{format}` 재생 |
| `sound:<abs_path_no_ext>` | `sound:/var/lib/asterisk/sounds/custom-ko/intro` | 절대경로의 파일 재생 (확장자 생략) |
| `number:<n>` | `number:1234` | "천이백삼십사" (Asterisk 내장 합성) |
| `digits:<n>` | `digits:1234` | "일 이 삼 사" |
| `characters:<s>` | `characters:abc` | "에이 비 시" |
| `tone:<name>` | `tone:dial`, `tone:busy` | `indications.conf` 정의 톤 |

**반환값**: `{ linkedId, playbackId, state }`. `playbackId`는 중단/이벤트 매칭에 사용.

**비동기**: 메서드는 재생 **시작 직후** 즉시 반환합니다. 끝까지 기다리려면 `audio:playback` 이벤트(`lifecycle: done`)를 구독하거나 — 간단한 IVR에서는 다음 단계로 바로 넘어가도 무방합니다 (Asterisk가 버퍼링).

### 4.2 `collectDtmf` / `collect_dtmf`

```typescript
const res = await gw.collectDtmf({
  linkedId,
  maxDigits: 4,            // 최대 입력 자릿수
  timeoutMs: 10_000,       // 전체 타임아웃
  interDigitTimeoutMs: 3_000, // 각 자릿수 사이 대기
  terminator: '#',         // 입력 종료 키 (선택)
});
// res.digits, res.timedOut, res.terminatedBy
```

`mode=lite`에서도 동일하게 동작 — AMI DTMFBegin/End 이벤트가 채널 점유 상태와 무관하게 발생하기 때문.

### 4.3 통화 제어

| 메서드 (TS / Python) | 용도 |
|------|------|
| `hangup(linkedId)` / `hangup(lid)` | 통화 종료 |
| `redirect(linkedId, { context, exten })` / `redirect(lid, context=..., exten=...)` | 다이얼플랜의 다른 익스텐션으로 전환 (상담원 큐, 본사 라우팅 등) |

`mode=lite`에선 **사용 불가** 메서드 (ExternalMedia 필요):
- ❌ `playAudio` / `play_audio` (URL → ffmpeg → 스트리밍 PCM 주입)
- ❌ `injectTts` / `inject_tts` (PCM TTS 스트리밍 주입)
- ❌ `say` / `broadcast_say` (TTS 어댑터 경유)
- ❌ `streamAudio` / `stream_audio` (오디오 수신)

→ 실시간 PCM 스트림 / STT 같은 기능이 필요하면 `mode=lite` 대신 `mode=both`(기본) 사용.

### 4.3 `liteTtsPlayback({ linkedId, text, provider?, voice? })` *(SDK 1.7.2+ · gateway 1.4.5.7+)*

**자유 텍스트 → 음성 재생** — 사전 녹음 없이 동적 안내음을 만들고 싶을 때 씁니다. 사운드 파일 키(`sound:welcome` 등)는 정적 콘텐츠에 적합하지만, **고객명·잔액·동적 메시지** 같은 게 끼면 매번 파일을 미리 만들 수 없으므로 이 메서드가 필요합니다.

```typescript
const result = await gw.liteTtsPlayback({
  linkedId,
  text: `${customerName}님 안녕하세요. 잔액은 ${balance}원입니다.`,
  provider: 'google',  // 옵션 — 미지정 시 테넌트 기본
  voice: 'ko-KR-Wavenet-A',  // 옵션 — 미지정 시 provider 기본
});
console.log(result.playbackId, result.cacheHit);
```

```python
result = await gw.lite_tts_playback(
    lid,
    f"{name}님 안녕하세요. 잔액은 {balance}원입니다.",
    provider="google",        # None → 테넌트 기본
)
print(result.playback_id, result.cache_hit)
```

**파라미터**:
- `text` — 합성할 텍스트 (필수). 빈 문자열은 `ValueError` / 클라이언트 에러.
- `provider` — `google` / `elevenlabs` / `openai` / `gemini` / `cosyvoice`. 생략 시 테넌트의 primary TTS 키 사용.
- `voice` — provider별 음성 ID (예: `ko-KR-Wavenet-A`). 생략 시 provider 기본 음성.

**반환값**: `{ linkedId, playbackId, state, media, synthesizedBytes, cacheHit, provider, voice }`. `cacheHit=true`면 게이트웨이가 디스크 캐시에서 즉시 재생한 것이고, 합성 RTT가 0입니다.

**캐시 동작**: `sha256(tenant | provider | voice | text)` 키로 `.sln16` 파일을 디스크에 저장 (기본 `/var/lib/dvgateway/tts-cache/{tenant}/{hash}.sln16`). **같은 문장을 N번 호출하면 1번만 합성**, 나머지는 50ms 이내 응답. 반복 안내(메뉴, 환영 멘트)에서 효과 큼. 캐시 위치는 게이트웨이의 `GW_TTS_CACHE_DIR` 환경변수로 변경 가능.

**Provider 실패 시**: cloud TTS 호출이 실패하면 게이트웨이가 자동으로 espeak-ng 로컬 합성으로 fallback (영어 발음, 품질은 낮지만 통화 끊김은 방지). 게이트웨이 로그에 `[PLAYBACK-TTS] cloud synth failed ... falling back to espeak-ng`.

**중단**: 일반 playback과 동일 — `stopPlayback(linkedId, playbackId)` / `stop_playback(linked_id, playback_id)`.

**이벤트**: `audio:playback` 이벤트 (`lifecycle: playing` → `done`) 가 발화됨. `tts:playback` 이벤트(`inject_tts` 라이프사이클) 는 발화되지 **않음** — 그건 ExternalMedia 기반 PCM 주입 전용이고 이 메서드는 ARI Playback 경로라서.

---

## 5. 자주 쓰는 패턴

### 5.1 PIN 입력 → 자릿수 그대로 안내

```typescript
await gw.playback({ linkedId, media: 'sound:enter-4-digit-pin' });
const res = await gw.collectDtmf({ linkedId, maxDigits: 4, terminator: '#' });
if (res.timedOut) {
  await gw.playback({ linkedId, media: 'sound:timeout' });
} else {
  // 입력 받은 PIN을 한 자리씩 읽어주기
  await gw.playback({ linkedId, media: `digits:${res.digits}` });
}
```

### 5.2 영업시간/공휴일 분기

```typescript
const hour = new Date().getHours();
const isBusinessHours = hour >= 9 && hour < 18;

await gw.playback({
  linkedId,
  media: isBusinessHours ? 'sound:welcome-day' : 'sound:office-closed',
});
```

### 5.3 메뉴 → 상담원 큐 라우팅

```typescript
const res = await gw.collectDtmf({ linkedId, maxDigits: 1, timeoutMs: 5_000 });
const queueMap: Record<string, string> = {
  '1': 'queue-sales',
  '2': 'queue-support',
  '3': 'queue-billing',
};
const target = queueMap[res.digits];
if (target) {
  await gw.playback({ linkedId, media: 'sound:transferring' });
  await gw.redirect(linkedId, { context: target, exten: 's' });
} else {
  await gw.playback({ linkedId, media: 'sound:invalid-key' });
  await gw.hangup(linkedId);
}
```

### 5.4 다국어 안내 (DID 기반)

```typescript
const lang = evt.session.did?.startsWith('+1') ? 'en' : 'ko';
await gw.playback({ linkedId, media: `sound:${lang}/welcome` });
```

(`sound:` URI는 Asterisk가 자동으로 `/var/lib/asterisk/sounds/{lang}/...` 경로에서 찾습니다 — 채널 변수 `LANGUAGE` 설정 필요)

### 5.5 콜백 예약 (시간대 번호 선택)

```typescript
await gw.playback({ linkedId, media: 'sound:choose-callback-time' });
const slot = await gw.collectDtmf({ linkedId, maxDigits: 1, timeoutMs: 8_000 });
const slots = ['09-12', '12-15', '15-18'];
const chosen = slots[parseInt(slot.digits) - 1];
if (chosen) {
  // 내부 DB에 예약 저장 (gateway API 외 — 사용자 시스템)
  await saveCallback({ caller: evt.session.caller, slot: chosen });
  await gw.playback({ linkedId, media: 'sound:callback-confirmed' });
}
await gw.hangup(linkedId);
```

---

## 6. 프로덕션 팁

### 6.1 한국어 사운드 파일 준비

Asterisk 기본 사운드는 영어입니다. 한국어 안내 멘트를 사용하려면:

```bash
# /var/lib/asterisk/sounds/ko/ 아래에 미리 합성한 sln16 또는 wav를 배치
sudo mkdir -p /var/lib/asterisk/sounds/ko
sudo cp welcome-ko.sln16 /var/lib/asterisk/sounds/ko/welcome.sln16

# 다이얼플랜에서 채널 언어 설정
exten => _8X.,1,Set(CHANNEL(language)=ko)
 same => n,Stasis(dvgateway,mode=lite,...)
```

미리 클라우드 TTS로 합성 → 파일로 저장하면 **재생 비용 0원**, **레이턴시 0ms** (네트워크 왕복 제거).

### 6.2 동시통화 수용량

`lite` 모드는 통화당 자원이 거의 들지 않으므로, 동일 하드웨어에서 일반 모드 대비 **3~5배** 더 많은 동시통화를 수용할 수 있습니다. 단, 라이선스 동시통화 제한은 동일하게 적용되므로 티어 선택 시 고려.

### 6.3 에러 핸들링

```typescript
try {
  await gw.playback({ linkedId, media: 'sound:welcome' });
} catch (err) {
  // 흔한 원인: 파일 경로 오타, 채널이 이미 끊김
  console.error('playback failed', err);
  // lite 모드에선 say()로 폴백 불가 — hangup이 안전
  await gw.hangup(linkedId).catch(() => {});
}
```

### 6.4 멀티테넌트 격리

테넌트별 사운드 디렉토리를 두면 같은 메뉴 트리를 고객사별로 분기할 수 있습니다.

```typescript
const tenant = evt.session.tenantId ?? 'default';
await gw.playback({
  linkedId,
  media: `sound:/var/lib/asterisk/sounds/tenants/${tenant}/welcome`,
});
```

### 6.5 모니터링

`lite` 모드 통화도 일반 모드와 동일하게 대시보드(`:8081`)에 표시되고 CDR/통계가 기록됩니다. `mode` 컬럼으로 lite 통화만 필터링해 사용량을 추적할 수 있습니다.

```sql
-- CDR_BACKEND=db 일 때
SELECT COUNT(*), tenant_id
FROM cdr_events
WHERE mode = 'lite' AND created_at > now() - interval '24 hours'
GROUP BY tenant_id;
```

---

## 7. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `playback`이 503 반환 | `ARI_ENABLED=false` | gateway env에 `ARI_ENABLED=true` 설정 |
| `playback`이 404 반환 | linkedId에 매핑된 활성 채널 없음 | `call:new` 이벤트 수신 후 호출하는지 확인 |
| `playback`이 502 / ARI 404 | Asterisk가 media 파일 못 찾음 | 경로/확장자 확인. `sound:` 뒤엔 **확장자 없이** 적기 |
| DTMF 입력이 안 받힘 | 채널 응답 전 / AMI 미연결 | 게이트웨이 로그에서 `[AMI] DTMFBegin` 확인 |
| `collect_dtmf`가 즉시 timeout | 채널이 Up 상태가 아님 | lite 모드는 자동 응답하지만, 다이얼플랜에서 `Answer()` 먼저 호출도 가능 |
| 일반 모드 메서드 호출 시 에러 | `playAudio`/`injectTts`는 ExtMedia 필요 | `playback`만 사용. 또는 다이얼플랜에서 `mode=both`로 변경 |
| 통화가 끊기지 않음 | `hangup()` 호출 누락 | `try/finally`로 보장 |

---

## 8. 일반 모드와 혼합 사용

같은 SDK 클라이언트로 일반 모드 통화와 lite 모드 통화를 모두 처리할 수 있습니다. `evt.session.mode`로 분기하면 됩니다.

```typescript
gw.onCallEvent(async (evt) => {
  if (evt.type !== 'call:new') return;
  const { linkedId, mode } = evt.session;

  if (mode === 'lite') {
    await handleSimpleIVR(linkedId);     // 본 가이드의 패턴
  } else {
    await handleAIConversation(linkedId); // STT/LLM/TTS 파이프라인
  }
});
```

다이얼플랜 측에서는 익스텐션 패턴/DID/시간대 등에 따라 `mode` 파라미터만 다르게 줘서 라우팅합니다.

```ini
; AI 상담은 mode=both, 단순 IVR은 mode=lite
exten => _9X.,1,Stasis(dvgateway,mode=both,...)   ; AI 봇 전용 번호대
exten => _8X.,1,Stasis(dvgateway,mode=lite,...)   ; 안내·IVR 전용 번호대
```

---

## 9. 다음 단계

- **음성 대화가 필요해졌다면** → [03 파이프라인 패턴](03-pipeline-patterns.md)
- **상담원 보조가 필요하다면** → [13 VoiceFlow 컨트롤](13-voice-flow-controls.md)
- **DTMF 동작 상세** → [10 FAQ & 트러블슈팅](10-faq-troubleshooting.md)의 DTMF 섹션
- **다이얼플랜 전체 예시** → `go-gateway/docs/asterisk-dialplan.md`

---

_최종 업데이트: 2026-05-20 · gateway 1.4.3+ / SDK 1.7.0+ 대상_
