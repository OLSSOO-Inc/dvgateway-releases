# 17. 최소 비용 IVR 봇 만들기 (`mode=lite`)

> **요약** — 안내 멘트 + 번호(DTMF) 입력만 받으면 되는 통화에는 `mode=lite` 프로파일이 **표준 패턴**입니다. STT/LLM/TTS 어댑터·실시간 PCM 스트림이 전부 빠지고 재생(`playback`) API + DTMF 이벤트만 사용해, 통화당 자원 사용을 크게 줄일 수 있습니다.
>
> Gateway 1.4.3+ / SDK 1.7.0+ 부터 지원. 동시통화 한도·통화기록(CDR)·테넌트 격리는 일반 모드와 동일합니다.

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
| 콜센터 상담원 실시간 보조 | 모니터 모드 (운영사 설정) | 음성 캡처 + 분석 필요 |

**판단 기준 한 줄**: "고객의 **말**을 들어야 하나, **번호 입력**만 받으면 되나?" 후자라면 lite.

---

## 2. 리소스 절감 효과 (대략)

`lite` 모드는 통화당 다음 자원을 **사용하지 않습니다**:

- 실시간 오디오 스트림 연결 (게이트웨이 ↔ 내 앱)
- 통화 오디오 캡처·믹싱
- STT 세션 (제공자 연결 + 오디오 버퍼)
- 음량 보정 / 음성 감지 처리
- 오디오 PCM 버퍼

또한 **STT 호출이 0건**이고, 사운드 파일 (`sound:`/`number:`/`digits:`/`tone:`)만 쓰는 IVR이라면 **TTS 호출도 0건**입니다. 동적 TTS가 필요하면 `liteTtsPlayback()` 으로 추가 가능하며, 같은 문장은 게이트웨이 캐시 적중으로 1회만 합성하므로 cloud TTS 호출 비용도 호출당이 아니라 **문장당**으로 떨어집니다.

---

## 3. SDK 표준 패턴

### 3.1 번호 연결 (운영사)

어떤 전화번호를 `lite` 모드로 받을지는 운영사가 설정합니다. 운영사에 "이 번호를 lite 모드로 연결해 달라"고 요청하세요. 연결된 통화는 `call:new` 이벤트의 `session.mode` 가 `'lite'` 로 옵니다.

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
        await gw.redirect(linkedId, 's', 'queue-sales');
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
                await gw.redirect(lid, "s", context="queue-sales")
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
| `sound:<filename>` | `sound:welcome` | 등록된 사운드 파일 `welcome` 재생 (채널 언어 기준) |
| `sound:<path_no_ext>` | `sound:custom-ko/intro` | 운영사가 등록한 경로의 파일 재생 (확장자 생략) |
| `number:<n>` | `number:1234` | "천이백삼십사" (내장 숫자 읽기) |
| `digits:<n>` | `digits:1234` | "일 이 삼 사" |
| `characters:<s>` | `characters:abc` | "에이 비 시" |
| `tone:<name>` | `tone:dial`, `tone:busy` | 내장 신호음 |

**반환값**: `{ linkedId, playbackId, state }`. `playbackId`는 `stopPlayback()` 으로 중단할 때 씁니다.

**비동기**: 메서드는 재생 **시작 직후** 즉시 반환합니다. ⚠️ **재생 완료 이벤트는 오지 않습니다** — `audio:playback` 은 `playAudio()` 전용이라 lite 통화의 `playback()` 에는 발생하지 않습니다. 간단한 IVR에서는 다음 단계로 바로 넘어가도 무방합니다(재생은 순서대로 이어지고, 안내가 나오는 동안 `collectDtmf()` 로 입력을 받을 수 있습니다). 정말 끝까지 기다려야 하면 아래 `liteTtsPlayback()` 의 `synthesizedBytes` 로 길이를 계산하세요.

### 4.2 `collectDtmf` / `collect_dtmf`

```typescript
const res = await gw.collectDtmf({
  linkedId,
  maxDigits: 4,            // 최대 입력 자릿수
  timeoutMs: 10_000,       // 전체 타임아웃
  interDigitTimeoutMs: 3_000, // 각 자릿수 사이 대기
  terminator: '#',         // 입력 종료 키 (선택)
});
// res.digits, res.timedOut, res.terminatedByKey
```

`mode=lite`에서도 동일하게 동작 — DTMF 이벤트는 오디오 스트림 유무와 무관하게 발생하기 때문.

### 4.3 통화 제어

| 메서드 (TS / Python) | 용도 |
|------|------|
| `hangup(linkedId)` / `hangup(lid)` | 통화 종료 |
| `redirect(linkedId, destination, context?)` / `redirect(lid, destination, context=...)` | 다른 목적지로 전환 (상담원 큐, 본사 라우팅 등). 전환할 `context`·`destination` 값은 운영사에 확인하세요 |

`mode=lite`에선 **사용 불가** 메서드 (실시간 오디오 스트림 필요):
- ❌ `playAudio` / `play_audio` (URL 오디오 스트리밍 주입)
- ❌ `injectTts` / `inject_tts` (PCM TTS 스트리밍 주입)
- ❌ `say` / `broadcast_say` (TTS 어댑터 경유)
- ❌ `streamAudio` / `stream_audio` (오디오 수신)

→ 실시간 PCM 스트림 / STT 같은 기능이 필요하면 `mode=lite` 대신 `mode=both`(기본) 사용.

### 4.4 `liteTtsPlayback({ linkedId, text, provider?, voice? })` *(SDK 1.7.2+ · gateway 1.4.5.8+)*

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

**반환값**: `{ linkedId, playbackId, state, media, synthesizedBytes, cacheHit, provider, voice }`. `cacheHit=true`면 게이트웨이가 캐시에서 즉시 재생한 것이고, 합성 대기 시간이 없습니다.

**캐시 동작**: 게이트웨이가 테넌트·provider·voice·text 가 같은 합성 결과를 캐시합니다. **같은 문장을 N번 호출하면 1번만 합성**, 나머지는 50ms 이내 응답. 반복 안내(메뉴, 환영 멘트)에서 효과 큼.

**Provider 실패 시**: cloud TTS 호출이 실패하면 게이트웨이가 자동으로 기본 로컬 음성으로 대체 재생합니다 (영어 발음, 품질은 낮지만 통화 끊김은 방지). 대체 재생이 반복되면 TTS 키 설정을 운영사에 확인하세요.

**중단**: 일반 playback과 동일 — `stopPlayback(linkedId, playbackId)` / `stop_playback(linked_id, playback_id)`.

**이벤트**: ⚠️ 재생 시작·완료 이벤트는 **오지 않습니다.** `audio:playback`(`playAudio()` 전용)도, `tts:playback`(`injectTts()` 전용)도 발생하지 않습니다. 재생이 끝난 뒤 이어서 할 일이 있으면 길이로 기다리세요 — 합성 오디오는 16kHz 16-bit 모노라 **1초 = 32,000바이트**이므로 `synthesizedBytes / 32000` 초 + 여유(약 0.5초)입니다.

```typescript
const r = await gw.liteTtsPlayback({ linkedId, text: '상담원을 연결합니다.' });
await new Promise((ok) => setTimeout(ok, (r.synthesizedBytes / 32000) * 1000 + 500));
await gw.redirect(linkedId, '1000');
```

```python
r = await gw.lite_tts_playback(linked_id, "상담원을 연결합니다.")
await asyncio.sleep(r.synthesized_bytes / 32000 + 0.5)
await gw.redirect(linked_id, "1000")
```

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
  await gw.redirect(linkedId, 's', target);
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

(언어별 사운드 파일 등록과 채널 언어 설정은 운영사가 합니다 — 필요한 언어를 운영사에 알려 주세요)

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

기본 사운드는 영어입니다. 한국어 안내 멘트를 사용하려면:

1. 안내 멘트를 미리 클라우드 TTS로 합성하거나 녹음해 파일로 준비합니다.
2. 운영사에 파일을 전달해 등록과 채널 언어(한국어) 설정을 요청합니다.
3. 등록된 이름으로 `sound:welcome` 처럼 재생합니다.

미리 합성해 둔 파일을 쓰면 **재생 비용 0원**, **레이턴시 0ms** (네트워크 왕복 제거). 파일 등록이 어렵다면 `liteTtsPlayback()` 의 캐시를 활용하세요.

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
  media: `sound:tenants/${tenant}/welcome`, // 운영사가 등록한 경로
});
```

### 6.5 모니터링

`lite` 모드 통화도 일반 모드와 동일하게 통화기록(CDR)·통계에 기록됩니다. lite 통화만 따로 집계한 사용량이 필요하면 운영사에 문의하세요.

---

## 7. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `playback`이 503 반환 | 게이트웨이의 재생 기능이 꺼져 있음 | 운영사에 문의 (`linkedId`·시각 전달) |
| `playback`이 404 반환 | linkedId에 매핑된 활성 채널 없음 | `call:new` 이벤트 수신 후 호출하는지 확인 |
| `playback`이 502 반환 | 게이트웨이가 media 파일을 못 찾음 | 파일 이름 확인. `sound:` 뒤엔 **확장자 없이** 적기. 파일이 등록돼 있는지 운영사에 확인 |
| DTMF 입력이 안 받힘 | 채널 응답 전 / DTMF 이벤트 미수신 | `call:dtmf` 이벤트가 오는지 확인. 오지 않으면 운영사에 `linkedId`·시각 전달 |
| `collect_dtmf`가 즉시 timeout | 채널이 아직 응답(Up) 상태가 아님 | `channel:state` 가 `up` 이 된 뒤 호출 |
| 일반 모드 메서드 호출 시 에러 | `playAudio`/`injectTts`는 실시간 오디오 스트림 필요 | `playback`만 사용. 또는 운영사에 그 번호를 일반 모드(`both`)로 연결 요청 |
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

어떤 번호를 어떤 모드로 받을지(예: AI 상담 번호는 `both`, 안내·IVR 번호는 `lite`)는 운영사가 번호별로 설정합니다.

---

## 9. 다음 단계

- **음성 대화가 필요해졌다면** → [03 파이프라인 패턴](03-pipeline-patterns.md)
- **상담원 보조가 필요하다면** → [13 VoiceFlow 컨트롤](13-voice-flow-controls.md)
- **DTMF 동작 상세** → [10 FAQ & 트러블슈팅](10-faq-troubleshooting.md)의 DTMF 섹션
- **번호를 lite / 일반 모드로 연결** → 운영사에 요청

---

_최종 업데이트: 2026-05-20 · gateway 1.4.3+ / SDK 1.7.0+ 대상_
