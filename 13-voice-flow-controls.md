# 13. 음성 플로우 제어 API

makecall Voice Flow / VoiceSOP 같은 오케스트레이터가 통화 흐름을 제어하는 데 사용하는 4가지 API를 한 문서에 정리합니다. 모든 기능은 Python SDK와 TypeScript SDK에서 동일한 시맨틱으로 제공됩니다.

---

## 목차

1. [사전 준비](#1-사전-준비)
2. [DTMF 수집 (collect\_dtmf / collectDtmf)](#2-dtmf-수집-collect_dtmf--collectdtmf)
3. [STT 음소거 (mute\_stt / muteStt)](#3-stt-음소거-mute_stt--mutestt)
4. [오디오 파일 재생 (play\_audio / playAudio)](#4-오디오-파일-재생-play_audio--playaudio)
5. [상담원 이관 (warm\_transfer / warmTransfer)](#5-상담원-이관-warm_transfer--warmtransfer)
6. [관련 문서](#6-관련-문서)

---

## 1. 사전 준비

SDK 설치 및 기본 연결 설정은 [01-getting-started.md](01-getting-started.md)를 참조하세요.

이 가이드의 API는 다음 환경변수가 게이트웨이에 설정되어 있어야 합니다.

| 환경변수 | 기본값 | 설명 |
|----------|--------|------|
| `GW_DTMF_ENABLED` | `true` | AMI DTMF 이벤트 포워딩 활성화 |
| `GW_DTMF_PHASE_FILTER` | `end` | `end` phase만 카운트 (키를 뗄 때 입력 완료) |

기본값으로 활성화되므로 별도 설정 없이 사용할 수 있습니다.

---

## 2. DTMF 수집 (collect\_dtmf / collectDtmf)

### 동작

발신자가 전화기 키패드로 누른 DTMF 숫자를 수집합니다. 다음 조건 중 하나가 충족되면 즉시 반환합니다.

- `max_digits` 개수만큼 수집 완료
- `terminator` 키 입력
- 첫 번째 키 대기 시간(`timeout_ms`) 초과
- 마지막 키 이후 다음 키 대기 시간(`inter_digit_timeout_ms`) 초과

수집 기간 동안 STT 파이프라인이 자동으로 음소거(`mute_stt=True`)되므로 DTMF 버튼음이 STT에 노이즈로 인식되지 않습니다.

### 파라미터

| 파라미터 | Python | TypeScript | 기본값 | 설명 |
|---------|--------|------------|--------|------|
| 통화 식별자 | `linked_id` | `linkedId` | — | 필수 |
| 최대 자릿수 | `max_digits` | `maxDigits` | `1` | 수집할 최대 숫자 개수 (>=1) |
| 첫 키 타임아웃 | `timeout_ms` | `timeoutMs` | `5000` | 첫 번째 키를 기다리는 시간 (ms) |
| 키 간 타임아웃 | `inter_digit_timeout_ms` | `interDigitTimeoutMs` | `2000` | 키 사이 대기 시간 (ms) |
| 종료 키 | `terminator` | `terminator` | `"#"` | 수집을 즉시 종료하는 키. `""` 로 비활성화 |
| STT 음소거 | `mute_stt` | `muteStt` | `True` | 수집 중 STT 자동 음소거 |

### 반환값 (DTMFResult)

| 필드 | Python | TypeScript | 설명 |
|------|--------|------------|------|
| 수집된 숫자 | `digits` | `digits` | 수집된 DTMF 문자열 (종료 키 미포함) |
| 타임아웃 여부 | `timed_out` | `timedOut` | 타임아웃으로 완료된 경우 `True` |
| 종료 키 사용 | `terminated_by_key` | `terminatedByKey` | `terminator` 키로 완료된 경우 `True` |

### Python 예제 — PIN 수집

```python
import asyncio
from dvgateway import DVGatewayClient
from dvgateway.auth.manager import ApiKeyAuth

gw = DVGatewayClient(
    base_url="https://gateway.example.com",
    auth={"type": "apiKey", "api_key": "your-api-key"},
)

async def handle_pin(linked_id: str):
    await gw.say(linked_id, "4자리 PIN을 입력하고 #을 누르세요.", tts)

    result = await gw.collect_dtmf(
        linked_id,
        max_digits=4,
        timeout_ms=10_000,
        inter_digit_timeout_ms=3_000,
        terminator="#",
    )

    if result.timed_out:
        await gw.say(linked_id, "입력 시간이 초과되었습니다.", tts)
        return

    await verify_pin(result.digits)  # "1234" 형태
```

### TypeScript 예제 — PIN 수집

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: 'https://gateway.example.com',
  auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY! },
});

async function handlePin(linkedId: string) {
  await gw.say(linkedId, '4자리 PIN을 입력하고 #을 누르세요.', tts);

  const result = await gw.collectDtmf({
    linkedId,
    maxDigits: 4,
    timeoutMs: 10_000,
    interDigitTimeoutMs: 3_000,
    terminator: '#',
  });

  if (result.timedOut) {
    await gw.say(linkedId, '입력 시간이 초과되었습니다.', tts);
    return;
  }
  await verifyPin(result.digits); // "1234" 형태
}
```

### 게이트웨이 내부 동작

- AMI `DTMFBegin` / `DTMFEnd` 이벤트를 callinfo WebSocket 스트림으로 포워딩
- SDK는 `phase === "end"` 이벤트만 카운트 (키를 뗄 때 입력 완료, IVR 표준 방식)
- STT 음소거는 레퍼런스 카운터로 관리 — 동일 `linked_id`에 `collect_dtmf`를 동시에 여러 개 호출해도 안전하게 공존하며, 마지막 수집이 끝날 때만 음소거 해제

### 주의사항

- `max_digits`에 도달한 경우 `timed_out=False`이므로 `timed_out` 플래그만 확인하면 정상/비정상을 구분할 수 있습니다.
- `terminator=""` 설정 시 `max_digits` 또는 타임아웃으로만 완료됩니다.
- Dynamic VoIP 다이얼플랜에서 DTMF 감지 방식(`dtmfmode`)이 `auto` 또는 `rfc2833`인지 확인하세요.

---

## 3. STT 음소거 (mute\_stt / muteStt)

### 사용 시나리오

`collect_dtmf`는 내부적으로 STT를 자동 음소거합니다. 다음 상황에서는 직접 `mute_stt` / `unmute_stt`를 사용하세요.

- 민감 정보(카드 번호, 주민번호) 입력 구간을 STT에서 제외할 때
- 외부 DTMF 어댑터를 사용해 직접 DTMF를 처리할 때
- 특정 구간만 녹취·전사를 중단해야 할 때

### 파라미터

| 메서드 | 파라미터 | 설명 |
|--------|---------|------|
| `mute_stt` / `muteStt` | `linked_id` / `linkedId` | 대상 통화 |
| | `duration_ms` / `durationMs` (선택) | 자동 만료 시간 (ms). 생략하면 명시적 unmute 필요 |
| `unmute_stt` / `unmuteStt` | `linked_id` / `linkedId` | 음소거 강제 해제 (레퍼런스 카운터 0으로 초기화) |

### Python 예제

```python
# 카드 번호 입력 구간 음소거 (최대 30초 자동 만료)
await gw.mute_stt(linked_id, duration_ms=30_000)
card_result = await gw.collect_dtmf(
    linked_id, max_digits=16, timeout_ms=30_000, mute_stt=False
)
await gw.unmute_stt(linked_id)
```

### TypeScript 예제

```typescript
// 카드 번호 입력 구간 음소거 (최대 30초 자동 만료)
await gw.muteStt(linkedId, 30_000);
const cardResult = await gw.collectDtmf({
  linkedId, maxDigits: 16, timeoutMs: 30_000, muteStt: false,
});
await gw.unmuteStt(linkedId);
```

### 레퍼런스 카운터 동작

`collect_dtmf`가 내부적으로 사용하는 음소거와 `mute_stt` 직접 호출은 레퍼런스 카운터를 공유합니다.

- `mute_stt` 호출 수만큼 카운터 증가
- `unmute_stt`는 카운터를 0으로 강제 초기화 (이스케이프 해치)
- 카운터가 0이 될 때만 게이트웨이에 실제 음소거 해제 요청 전송

`collect_dtmf` 도중에 `unmute_stt`를 직접 호출하면 수집 중인 DTMF 음이 STT에 노출될 수 있습니다.

---

## 4. 오디오 파일 재생 (play\_audio / playAudio)

### 동작

HTTP(S) URL의 오디오 파일을 다운로드해 통화 채널에 주입합니다. 게이트웨이가 FFmpeg를 사용해 mp3/wav/ogg 등을 16kHz 모노 PCM으로 자동 변환합니다.

주요 용도: IVR 안내 멘트, 법적 고지, 대기 음악, 사전 녹음 안내

### 파라미터

| 파라미터 | Python | TypeScript | 기본값 | 설명 |
|---------|--------|------------|--------|------|
| 통화 식별자 | `linked_id` | `linkedId` | — | 필수 |
| 오디오 URL | `url` | `url` | — | 필수. HTTP(S) URL |
| 반복 재생 | `loop` | `loop` | `False` | `True`면 `stop_audio` 호출 전까지 반복 |
| DTMF 중단 | `interrupt_on_dtmf` | `interruptOnDtmf` | `False` | DTMF 입력 시 즉시 재생 중단 |
| 완료 대기 | `wait_for_completion` | `waitForCompletion` | `True` | `False`면 재생 시작 후 즉시 반환 |

### 반환값 (PlayAudioResult)

| 필드 | Python | TypeScript | 설명 |
|------|--------|------------|------|
| 완료 여부 | `completed` | `completed` | 자연 종료 시 `True` |
| DTMF 중단 키 | `interrupted_by_dtmf` | `interruptedByDtmf` | 중단한 DTMF 키 문자열, 없으면 `None`/`null` |
| 재생 시간 | `duration_ms` | `durationMs` | 재생된 시간 (ms). `wait_for_completion=False`이면 `0` |

### Python 예제 — 법적 고지 + DTMF 동의

```python
res = await gw.play_audio(
    linked_id,
    url="https://cdn.example.com/legal-notice.mp3",
    interrupt_on_dtmf=True,
    wait_for_completion=True,
)

if res.interrupted_by_dtmf == "1":
    await process_consent(linked_id)  # "1" = 동의
elif res.interrupted_by_dtmf == "2":
    await gw.say(linked_id, "서비스를 종료합니다.", tts)
    await gw.hangup(linked_id)
```

### TypeScript 예제 — 대기 음악 + 취소

```typescript
// 대기 음악 시작 (비동기 — 즉시 반환)
await gw.playAudio({
  linkedId,
  url: 'https://cdn.example.com/hold-music.mp3',
  loop: true,
  waitForCompletion: false,
});

// 상담원 연결 완료 후 음악 중단
await connectToAgent(linkedId);
await gw.stopAudio(linkedId);
```

### 보안 주의사항

게이트웨이는 URL을 서버 측에서 다운로드합니다.

- HTTP(S) 스킴만 허용. `file://`, `ftp://` 등은 지원하지 않습니다.
- 사용자 입력을 URL에 직접 포함하지 마세요 (SSRF 위험).
- 내부 네트워크 IP(192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x.x.x)로의 요청은 게이트웨이 방화벽 정책에 따라 차단될 수 있습니다.

### FFmpeg 의존성

`play_audio`는 게이트웨이 서버에 FFmpeg가 설치되어 있어야 합니다.

```bash
sudo apt install -y ffmpeg
```

설치 후 게이트웨이를 재시작하세요. FFmpeg 없이 wav/mp3를 재생하면 게이트웨이 로그에 오류가 기록됩니다.

### wait_for_completion 선택 기준

| 시나리오 | 권장 설정 |
|---------|-----------|
| 안내 멘트 완료 후 다음 단계 진행 | `wait_for_completion=True` (기본값) |
| 대기 음악(언제 끝날지 모름) | `wait_for_completion=False` + `loop=True` + 이후 `stop_audio` |
| 재생 중 다른 처리 병행 | `wait_for_completion=False` |

`waitForCompletion=false`인 경우 반환값은 항상 `{ completed: false, durationMs: 0, interruptedByDtmf: null }` 입니다.

---

## 5. 상담원 이관 (warm\_transfer / warmTransfer)

### 동작

통화를 상담원 내선 또는 외부 PSTN 번호로 이관합니다. 게이트웨이가 상담원 레그를 새로 발신하고, 상담원이 수신하면 양 레그를 브릿지합니다. 이관 중에는 발신자에게 대기 음악을 재생할 수 있고, 상담원이 응답한 직후 — 브릿지 *전* — 에 상담 준비 정보(whisper)를 상담원에게만 들려줄 수 있습니다.

**SDK 1.6.5 / Gateway 1.3.9.6 부터:**

- 외부 휴대폰/유선번호로의 이관 지원 (`outbound=True` 옵션)
- whisper TTS 실제 재생 — 게이트웨이가 테넌트별 클라우드 TTS 프로바이더로 16 kHz PCM 을 합성하여 상담원 채널에 ARI Play 로 주입. 활성 TTS 프로바이더가 없으면 whisper 만 조용히 스킵 (이관 자체는 정상)
- 상담원 레그 outbound caller-ID / accountcode 지정 (`cid_number`, `cid_name`, `account_code`)

> **Gateway 1.3.9.5 회귀 안내**: 1.3.9.5 는 `outbound=True` 시 게이트웨이가 상담원 leg 에 ExternalMedia 를 자동 부착하여 customer↔agent audio bridge 가 형성되지 않는 버그가 있습니다. 외부 PSTN 이관을 사용한다면 **반드시 1.3.9.6 이상**을 배포하세요. 내부 내선 이관(`outbound=False` 기본)은 1.3.9.5 에서도 정상 동작합니다.

### 파라미터

| 파라미터 | Python | TypeScript | 기본값 | 설명 |
|---------|--------|------------|--------|------|
| 통화 식별자 | `linked_id` | `linkedId` | — | 필수 |
| 이관 대상 | `destination` | `destination` | — | 필수. 상담원 내선 번호 또는 외부 PSTN 번호 (`01026132471` 등) |
| 귀속 안내문 | `whisper_text` | `whisperText` | `""` | 상담원에게만 들리는 안내 (브릿지 전 재생) |
| 대기 음악 URL | `hold_audio_url` | `holdAudioUrl` | `""` | 발신자 대기 중 재생할 오디오 URL |
| 다이얼플랜 컨텍스트 | `context` | `context` | `"from-internal"` | 상담원 레그 발신 컨텍스트. `outbound=True` 시 트렁크 컨텍스트 (예: `"cos-all"`) |
| 이관 타임아웃 | `timeout_ms` | `timeoutMs` | `30000` | 상담원 수신 대기 시간 (ms, >0) |
| 외부 PSTN 라우팅 | `outbound` | `outbound` | `False` | `True` 시 endpoint 를 `Local/{dest}@{context}` 로 강제 — 외부 PSTN/트렁크 라우팅. 기본 false (digit-only → PJSIP 내부 peer) |
| Outbound CID 번호 | `cid_number` | `cidNumber` | `""` | 상담원 레그 caller-ID 번호. `CALLERID(num)` + `EXTERNAL_CID_NUMBER` 양쪽에 주입되어 트렁크 측 P-Asserted-Identity 에 반영 |
| Outbound CID 이름 | `cid_name` | `cidName` | `""` | 상담원 레그 caller-ID 이름 (`CALLERID(name)`) |
| 계정 코드 | `account_code` | `accountCode` | `""` | CDR 계정 코드 (`CHANNEL(accountcode)`) |

### 반환값 (WarmTransferResult)

| 필드 | Python | TypeScript | 설명 |
|------|--------|------------|------|
| 연결 성공 | `connected` | `connected` | 상담원 수신 + 브릿지 완료 시 `True` |
| 타임아웃 | `timed_out` | `timedOut` | `timeout_ms` 초과 시 `True` |
| 오류 사유 | `error` | `error` | 실패 사유 문자열 (예: `"no_answer"`, `"originate_failed"`). 없으면 `None`/`null` |
| 상담원 채널 | `agent_channel` | `agentChannel` | 연결된 상담원 채널 이름. 실패 시 `None`/`null` |
| 브릿지 ID | `bridge_id` | `bridgeId` | 생성된 브릿지 ID. 실패 시 `None`/`null` |
| 귀속 재생 여부 | `whisper_played` | `whisperPlayed` | whisper 가 실제로 재생 완료된 경우 `True`. 활성 TTS 프로바이더 없거나 합성/재생 실패 시 `False` |

### Python 예제 — 내부 내선

```python
res = await gw.warm_transfer(
    linked_id,
    destination="1001",
    whisper_text="VIP 고객입니다. 주문번호 #12345",
    hold_audio_url="https://cdn.example.com/hold.mp3",
    timeout_ms=30_000,
)

if res.connected:
    # 상담원과 브릿지 완료 — 이후 통화는 상담원이 처리
    print(f"이관 완료: channel={res.agent_channel}, bridge={res.bridge_id}")
elif res.timed_out:
    await gw.say(linked_id, "죄송합니다. 잠시 후 다시 연결해 드리겠습니다.", tts)
else:
    await gw.say(linked_id, f"연결 실패: {res.error}", tts)
```

### Python 예제 — 외부 PSTN 번호

```python
res = await gw.warm_transfer(
    linked_id,
    destination="01026132471",            # 상담원 휴대폰
    outbound=True,                         # ★ 외부 PSTN 라우팅 활성화
    context="cos-all",                     # 트렁크 다이얼플랜 컨텍스트
    cid_number="16682471",                 # 트렁크 측에 표시될 발신번호
    cid_name="회사명",
    account_code="07045144800",            # CDR 계정 코드
    whisper_text="고객: 홍길동, 용건: 환불 문의",
    hold_audio_url="https://cdn.example.com/hold.mp3",
    timeout_ms=90_000,
)
```

### TypeScript 예제

```typescript
// 내부 내선
const res = await gw.warmTransfer({
  linkedId,
  destination: '1001',
  whisperText: 'VIP 고객입니다. 주문번호 #12345',
  holdAudioUrl: 'https://cdn.example.com/hold.mp3',
  timeoutMs: 30_000,
});

// 외부 PSTN 번호
const res = await gw.warmTransfer({
  linkedId,
  destination: '01026132471',
  outbound: true,
  context: 'cos-all',
  cidNumber: '16682471',
  cidName: '회사명',
  accountCode: '07045144800',
  whisperText: '고객: 홍길동, 용건: 환불 문의',
  holdAudioUrl: 'https://cdn.example.com/hold.mp3',
  timeoutMs: 90_000,
});
```

### Whisper 재생 동작

1. 상담원이 응답하면 게이트웨이가 `whisper_text` 를 테넌트별 클라우드 TTS 프로바이더로 16 kHz PCM 합성
2. PCM 을 게이트웨이 호스트의 `GW_WARM_TRANSFER_WHISPER_DIR`(기본 `/var/lib/dvgateway/whisper`)에 `.sln16` 임시 파일로 저장
3. ARI `POST /channels/{agentChannel}/play` 로 상담원 채널에만 재생 — 이 시점 발신자는 hold music/무음 상태이므로 whisper 가 발신자에게는 들리지 않음
4. PlaybackFinished 이벤트 또는 `GW_WARM_TRANSFER_WHISPER_TIMEOUT_MS`(기본 20초) 경과 후 임시 파일 삭제 → 양 레그를 브릿지

활성 클라우드 TTS 프로바이더가 없거나 합성/재생 중 어떤 단계라도 실패하면 whisper 만 스킵되고 (`whisper_played=False`) 이관 자체는 정상 진행됩니다.

### 타임아웃·실패 동작

- `timed_out=True`: 이관 실패. 원본 통화(`linked_id`)는 유지 상태이므로 후속 처리(재시도, 콜백 예약 등)를 진행할 수 있습니다.
- `error`가 있는 경우: 상담원 레그 발신 자체가 실패한 것이므로 원본 통화 역시 이미 끊겼을 가능성이 있습니다. 세션 상태를 확인하세요.
- `connected=True` 이후: SDK 측에서는 통화가 상담원에게 이관된 것으로 간주합니다. 상담원 통화 이후 이벤트(종료 등)는 AMI 이벤트 스트림에서 확인하세요.

### 게이트웨이 환경변수 (운영자용)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `GW_WARM_TRANSFER_ENABLED` | `true` | warm_transfer 마스터 스위치. ARI 활성화 (`ARI_ENABLED=true`) 필수 |
| `GW_WARM_TRANSFER_DEFAULT_TIMEOUT_MS` | `30000` | 클라이언트가 `timeoutMs` 미지정 시 적용되는 기본 타임아웃 |
| `GW_WARM_TRANSFER_DEFAULT_CONTEXT` | `"from-internal"` | 클라이언트가 `context` 미지정 시 적용되는 기본 컨텍스트 |
| `GW_WARM_TRANSFER_WHISPER_DIR` | `/var/lib/dvgateway/whisper` | whisper `.sln16` 임시 파일 디렉터리. **PBX 프로세스가 읽을 수 있어야 함**. 디렉터리는 게이트웨이가 자동 생성 (mode 0755), 파일은 0644 로 작성 |
| `GW_WARM_TRANSFER_WHISPER_TIMEOUT_MS` | `20000` | whisper PlaybackFinished 최대 대기 시간 (초과 시 whisper 스킵하고 브릿지 진행) |

---

## 6. 관련 문서

- REST 엔드포인트 상세: [../api.md](../api.md)
- DTMF 이벤트 수신 (`call:dtmf`): [05-events-fallback.md](05-events-fallback.md)
- TTS 주입 및 say(): [03-pipeline-patterns.md](03-pipeline-patterns.md)
- Comfort Noise (대기 중 배경음): [08-comfort-noise.md](08-comfort-noise.md)

---

_Last updated: 2026-05-02_
