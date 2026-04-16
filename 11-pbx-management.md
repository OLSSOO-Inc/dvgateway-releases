# PBX 관리 + 아웃바운드 캠페인

> SDK를 통해 착신전환, 발신자표시, 클릭투콜, 아웃바운드 캠페인을 관리합니다.

---

## 멀티테넌트 격리

DVGateway는 모든 PBX 관리 API에서 **테넌트 격리**를 보장합니다:

- **callinfo WebSocket**: 테넌트 클라이언트는 자기 테넌트의 통화 이벤트만 수신
- **오디오 스트림**: 다른 테넌트의 `linkedId`로 스트림 구독 시 403 차단
- **캠페인 이벤트**: 테넌트별로 필터링된 이벤트만 전달
- **Admin** (tenantID=""): 모든 테넌트의 데이터를 볼 수 있음

### 서버 식별 (멀티서버)

```
GW_SERVER_ID=server-01   # 환경변수 (미설정 시 hostname 자동 사용)
```

모든 이벤트와 CDR에 `serverId` 필드가 포함됩니다:

```json
{"event":"call:new", "serverId":"server-01", "tenantId":"tenant-a", ...}
```

---

## 1. 착신전환 (Diversions)

### TypeScript

```typescript
// 전체 규칙 조회 (CFI/CFB/CFN/CFU)
const rules = await gw.getDiversions('45144801', 'tenant-id');

// CFI 즉시 착신전환 활성화
await gw.setDiversion('45144801', 'CFI', {
  enable: 'yes',
  destination: '01012345678',
}, 'tenant-id');

// 비활성화 (번호 유지)
await gw.setDiversion('45144801', 'CFI', { enable: 'no' }, 'tenant-id');

// 완전 해제 (번호 삭제)
await gw.deleteDiversion('45144801', 'CFI', 'tenant-id');
```

### Python

```python
# 전체 규칙 조회
rules = await gw.get_diversions("45144801", tenant_id="tenant-id")

# CFI 즉시 착신전환 활성화
await gw.set_diversion("45144801", "CFI",
    enable="yes", destination="01012345678", tenant_id="tenant-id")

# 비활성화
await gw.set_diversion("45144801", "CFI", enable="no", tenant_id="tenant-id")

# 완전 해제
await gw.delete_diversion("45144801", "CFI", tenant_id="tenant-id")
```

### 착신전환 타입

| 타입 | 설명 | 적용 조건 |
|:----:|------|----------|
| **CFI** | 즉시 착신전환 | 무조건 |
| **CFB** | 통화중 착신전환 | 통화중일 때 |
| **CFN** | 부재중 착신전환 | 미응답 시 |
| **CFU** | 미연결 착신전환 | 단말기 오프라인 |

> ⚠️ 활성화 조건: `enable=yes` **AND** `destination` 설정 (둘 다 필요)

---

## 2. 발신자표시 (Caller ID)

### TypeScript

```typescript
// 조회
const cid = await gw.getCallerID('45144800');
console.log(cid.externalCid);
// { name: "OLSSOO Inc.", number: "16682471", raw: '"OLSSOO Inc." <16682471>' }

// 이름만 변경 + PBX 즉시 적용
await gw.setCallerID('45144800', { name: '홍길동', applyChanges: true });

// 번호만 변경 + PBX 즉시 적용
await gw.setCallerID('45144800', { number: '0212345678', applyChanges: true });

// 이름 + 번호 동시 변경 + PBX 즉시 적용
await gw.setCallerID('45144800', {
  name: 'OLSSOO Inc.',
  number: '16682471',
  applyChanges: true,
});
```

### Python

```python
# 조회
cid = await gw.get_caller_id("45144800")

# 이름 + 번호 변경 + PBX 즉시 적용
await gw.set_caller_id("45144800",
    name="OLSSOO Inc.", number="16682471", apply_changes=True)
```

> `applyChanges: true` → DB 변경 + PBX 설정 재적용을 한번의 호출로 처리

---

## 3. 클릭투콜 (Click-to-Call)

### TypeScript

```typescript
await gw.clickToCall({
  caller: '45144801',        // 내 단말번호
  callee: '01012345678',     // 전화 걸 번호
  cidName: 'OLSSOO',         // 발신자 이름
  cidNumber: '16682471',     // 발신자 번호
  customValue1: '홍길동',     // 커스텀 변수 (AI 봇에서 활용)
  customValue2: 'ORD-001',
  customValue3: '해피콜',
});
```

### Python

```python
await gw.click_to_call(
    caller="45144801",
    callee="01012345678",
    cid_name="OLSSOO",
    cid_number="16682471",
    custom_value_1="홍길동",
    custom_value_2="ORD-001",
    custom_value_3="해피콜",
)
```

---

## 4. 아웃바운드 캠페인

캠페인을 통해 **예약 발신**, **동보(대량) 발신**, **주기적 발신**을 관리합니다.

### 캠페인 타입

| 타입 | 설명 | 예시 |
|:----:|------|------|
| **scheduled** | 예약 발신 | "3/30 14:00에 전화" |
| **bulk** | 동보 발신 | "100명에게 동시 5채널" |
| **recurring** | 주기적 발신 | "매주 월요일 09:00" |

### 4.1 예약 발신

```typescript
const campaign = await gw.createCampaign({
  name: '고객 안내 전화',
  type: 'scheduled',
  caller: '45144801',
  cidName: 'OLSSOO',
  cidNumber: '16682471',
  schedule: {
    type: 'once',
    at: '2026-03-30T14:00:00+09:00',
    timezone: 'Asia/Seoul',
  },
  targets: [
    { callee: '01012345678', customValue1: '홍길동' },
  ],
});
```

### 4.2 동보(대량) 발신

```typescript
const campaign = await gw.createCampaign({
  name: '3월 해피콜',
  type: 'bulk',
  caller: '45144801',
  cidName: 'OLSSOO 해피콜',
  cidNumber: '16682471',
  schedule: {
    type: 'once',
    at: '2026-03-31T09:00:00+09:00',
    timeWindow: { start: '09:00', end: '18:00' },
    timezone: 'Asia/Seoul',
  },
  bulk: {
    concurrency: 5,       // 동시 5채널
    intervalSec: 3,        // 건별 3초 간격
    retryCount: 2,         // 실패 시 2회 재시도
    retryDelaySec: 300,    // 재시도 5분 대기
  },
  targets: [
    { callee: '01012345678', customValue1: '홍길동', customValue2: 'ORD-001' },
    { callee: '01098765432', customValue1: '김철수', customValue2: 'ORD-002' },
  ],
});
```

**대량 발신 설정:**

| 필드 | 기본값 | 설명 |
|------|:------:|------|
| `concurrency` | 1 | 동시 발신 채널 수 |
| `intervalSec` | 3 | 건별 발신 간격 (초) |
| `retryCount` | 0 | 실패 시 재시도 횟수 |
| `retryDelaySec` | 300 | 재시도 대기 시간 (초) |

### 4.3 주기적 발신

```typescript
// 매주 월요일 09:00 (04/01 ~ 12/31)
const campaign = await gw.createCampaign({
  name: '주간 해피콜',
  type: 'recurring',
  caller: '45144801',
  schedule: {
    type: 'cron',
    cron: '0 9 * * 1',
    startDate: '2026-04-01',
    endDate: '2026-12-31',
    timeWindow: { start: '09:00', end: '18:00' },
    timezone: 'Asia/Seoul',
  },
  bulk: { concurrency: 3, intervalSec: 5 },
  targets: [
    { callee: '01012345678', customValue1: '홍길동' },
  ],
});
```

**cron 표현식:** `분 시 일 월 요일`

| 표현식 | 의미 |
|--------|------|
| `0 9 * * 1` | 매주 월요일 09:00 |
| `0 9 * * 1-5` | 평일 09:00 |
| `0 9,14 * * *` | 매일 09:00, 14:00 |

### 4.4 캠페인 제어

```typescript
await gw.startCampaign('a1b2c3d4');    // 수동 시작
await gw.pauseCampaign('a1b2c3d4');    // 일시 정지
await gw.resumeCampaign('a1b2c3d4');   // 재개
await gw.cancelCampaign('a1b2c3d4');   // 취소

const results = await gw.getCampaignResults('a1b2c3d4');
```

```python
await gw.start_campaign("a1b2c3d4")
results = await gw.get_campaign_results("a1b2c3d4")
```

---

## 5. 캠페인 이벤트 모니터링

캠페인 실행 중 각 발신 건의 상태가 **실시간 WebSocket 이벤트**로 전송됩니다.

### 이벤트 타입

| 이벤트 | 설명 |
|--------|------|
| `campaign:started` | 캠페인 실행 시작 |
| `call:preparing` | 대상 데이터 읽기 완료, 발신 준비 |
| `call:dialing` | PBX에 발신 요청 (시도 N회) |
| `call:connected` | 발신 성공 |
| `call:failed` | 발신 실패 (에러 포함) |
| `call:retry` | 재시도 대기 중 |
| `campaign:completed` | 전체 완료 (결과 요약) |
| `campaign:paused` | 일시 정지 |
| `campaign:cancelled` | 취소 |

### 이벤트 데이터

```json
{
  "type": "campaign:call:dialing",
  "data": {
    "campaignId": "a1b2c3d4",
    "campaignName": "3월 해피콜",
    "eventType": "call:dialing",
    "callee": "01012345678",
    "attempt": 1,
    "targetIndex": 3,
    "totalTargets": 100,
    "timestamp": "2026-03-30T14:00:05+09:00"
  }
}
```

### 실시간 모니터링 예제 (Python)

```python
import asyncio
from dvgateway import DVGatewayClient
from dvgateway.adapters.tts import GeminiTtsAdapter

gw = DVGatewayClient(
    base_url="http://localhost:8080",
    auth={"type": "apiKey", "api_key": "dvgw_xxx"},
)
tts = GeminiTtsAdapter(api_key="AIza_xxx")

# 세션 카드 상태 추적
sessions = {}

async def on_event(event):
    # ── 캠페인 이벤트 처리 ────────────
    if hasattr(event, 'type') and str(event.type).startswith('campaign:'):
        data = event.data
        evt = data.get('eventType', '')
        callee = data.get('callee', '')

        if callee:
            sessions[callee] = {
                'state': evt,
                'index': data.get('targetIndex', 0),
                'total': data.get('totalTargets', 0),
                'attempt': data.get('attempt', 0),
            }

        icons = {
            'campaign:started': '🚀', 'call:preparing': '📋',
            'call:dialing': '📞', 'call:connected': '✅',
            'call:failed': '❌', 'call:retry': '🔄',
            'campaign:completed': '🏁',
        }
        icon = icons.get(evt, '⏳')

        if evt == 'campaign:started':
            print(f"{icon} 캠페인 시작: {data['campaignName']} ({data['totalTargets']}건)")
        elif callee:
            idx = data.get('targetIndex', 0) + 1
            total = data.get('totalTargets', 0)
            print(f"  {icon} [{idx}/{total}] {callee} — {evt}")
        if evt == 'campaign:completed':
            r = data.get('result', {})
            print(f"{icon} 완료: 성공 {r.get('success',0)}/{r.get('total',0)}")

    # ── AI 봇 연동 ────────────────────
    elif hasattr(event, 'type') and event.type == 'call:new':
        session = event.session
        customer = session.custom_value_1 or "고객"
        await gw.say(session.linked_id,
            f"안녕하세요 {customer}님, OLSSOO입니다.", tts)

gw.on_call_event(on_event)

# 캠페인 생성 + 시작
campaign = await gw.create_campaign({
    "name": "해피콜 테스트",
    "type": "bulk",
    "caller": "45144801",
    "cidName": "OLSSOO",
    "cidNumber": "16682471",
    "bulk": {"concurrency": 3, "intervalSec": 3, "retryCount": 1},
    "targets": [
        {"callee": "01012345678", "customValue1": "홍길동"},
        {"callee": "01098765432", "customValue1": "김철수"},
    ],
})
await gw.start_campaign(campaign["id"])
await asyncio.sleep(3600)
```

**실행 결과:**
```
🚀 캠페인 시작: 해피콜 테스트 (2건)
  📋 [1/2] 01012345678 — call:preparing
  📞 [1/2] 01012345678 — call:dialing
  ✅ [1/2] 01012345678 — call:connected
  📋 [2/2] 01098765432 — call:preparing
  📞 [2/2] 01098765432 — call:dialing
  ❌ [2/2] 01098765432 — call:failed
  🔄 [2/2] 01098765432 — call:retry
  📞 [2/2] 01098765432 — call:dialing
  ✅ [2/2] 01098765432 — call:connected
🏁 완료: 성공 2/2
```

---

## SDK 메서드 레퍼런스

### TypeScript

| 메서드 | 설명 |
|--------|------|
| `getDiversions(ext, tenantId?)` | 착신전환 조회 |
| `setDiversion(ext, type, params, tenantId?)` | 착신전환 설정 |
| `deleteDiversion(ext, type, tenantId?)` | 착신전환 해제 |
| `getCallerID(ext)` | 발신자표시 조회 |
| `setCallerID(ext, {name?, number?, applyChanges?})` | 발신자표시 변경 |
| `applyChanges()` | PBX 설정 재적용 |
| `clickToCall({caller, callee, ...})` | 클릭투콜 발신 |
| `createCampaign(campaign)` | 캠페인 생성 |
| `listCampaigns()` | 캠페인 목록 |
| `getCampaign(id)` | 캠페인 상세 |
| `updateCampaign(id, updates)` | 캠페인 수정 |
| `deleteCampaign(id)` | 캠페인 삭제 |
| `startCampaign(id)` | 캠페인 시작 |
| `pauseCampaign(id)` | 캠페인 일시정지 |
| `resumeCampaign(id)` | 캠페인 재개 |
| `cancelCampaign(id)` | 캠페인 취소 |
| `getCampaignResults(id)` | 발신 결과 조회 |

### Python

| 메서드 | 설명 |
|--------|------|
| `get_diversions(ext, tenant_id="")` | 착신전환 조회 |
| `set_diversion(ext, cf_type, ...)` | 착신전환 설정 |
| `delete_diversion(ext, cf_type, ...)` | 착신전환 해제 |
| `get_caller_id(ext)` | 발신자표시 조회 |
| `set_caller_id(ext, name="", number="", apply_changes=False)` | 발신자표시 변경 |
| `apply_changes()` | PBX 설정 재적용 |
| `click_to_call(caller, callee, ...)` | 클릭투콜 발신 |
| `create_campaign(campaign)` | 캠페인 생성 |
| `list_campaigns()` | 캠페인 목록 |
| `get_campaign(id)` | 캠페인 상세 |
| `update_campaign(id, updates)` | 캠페인 수정 |
| `delete_campaign(id)` | 캠페인 삭제 |
| `start_campaign(id)` | 캠페인 시작 |
| `pause_campaign(id)` | 캠페인 일시정지 |
| `resume_campaign(id)` | 캠페인 재개 |
| `cancel_campaign(id)` | 캠페인 취소 |
| `get_campaign_results(id)` | 발신 결과 조회 |

---

## 6. Early Media (응답 전 안내음)

전화 응답(Answer) 전에 안내음을 재생합니다. **DID별 개별 설정** 과 **테넌트 전체 기본값** 두 가지 레벨을 지원합니다 (v1.4+).

### 6.1 Per-DID 설정 — 특정 번호에만 적용

#### TypeScript

```typescript
// 조회
const config = await gw.getEarlyMedia('07045144801', 'tenant-id');

// 음원 URL + 활성화 (MP3 → 자동 WAV 변환)
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  audioUrl: 'https://www.makecall.io/greeting.mp3',
}, 'tenant-id');

// TTS 텍스트로 설정 (대시보드 프로바이더 API 키 자동 사용)
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  tts: {
    text: 'VIP 고객님, 잠시만 기다려 주세요.',
    provider: 'elevenlabs',   // optional, 미지정 시 dashboard primary
    voice: 'custom-voice-id',  // optional
  },
}, 'tenant-id');

// 비활성화만 (음원 유지)
await gw.setEarlyMedia('07045144801', { enabled: 'no' }, 'tenant-id');

// 다시 활성화
await gw.setEarlyMedia('07045144801', { enabled: 'yes' }, 'tenant-id');

// 음원만 교체
await gw.setEarlyMedia('07045144801', {
  audioUrl: 'https://cdn.example.com/new-greeting.mp3',
}, 'tenant-id');
```

#### Python

```python
# 조회
config = await gw.get_early_media("07045144801", tenant_id="tenant-id")

# 음원 URL + 활성화
await gw.set_early_media("07045144801",
    enabled="yes",
    audio_url="https://www.makecall.io/greeting.mp3",
    tenant_id="tenant-id")

# TTS 텍스트로 설정
await gw.set_early_media("07045144801",
    enabled="yes",
    tts={
        "text": "VIP 고객님, 잠시만 기다려 주세요.",
        "provider": "elevenlabs",   # optional
    },
    tenant_id="tenant-id")

# 비활성화만 (음원 유지)
await gw.set_early_media("07045144801", enabled="no", tenant_id="tenant-id")

# 다시 활성화
await gw.set_early_media("07045144801", enabled="yes", tenant_id="tenant-id")
```

---

### 6.2 테넌트 기본값 (v1.4+) — 개별 설정 없는 모든 DID에 자동 적용

수백 개 DID에 **동일한 안내음**을 일괄 적용하고 싶을 때, 각 DID마다 설정할 필요 없이 **한 번만** 테넌트 기본값을 저장하면 됩니다. 특정 DID에만 다른 안내음이 필요하면 그 DID에만 개별 설정 — 개별 설정이 기본값을 자동으로 오버라이드합니다.

#### 다이얼플랜 폴백 순서

`[dvgateway-pa-noa]` 컨텍스트는 인바운드 통화마다 다음 순서로 확인합니다:

```
1. 해당 DID의 개별 설정 enabled="yes"  →  Per-DID 프로파일 사용
2. 아니면 _default 프로파일 enabled="yes"  →  테넌트 기본값 사용
3. 둘 다 비활성  →  Early Media 스킵 (통화 즉시 처리)
```

#### TypeScript

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

// 편의 메서드 — 테넌트 기본값 조회
const def = await gw.getEarlyMediaDefault();
console.log(def.enabled, def.source, def.ttsText, def.fileExists);

// 편의 메서드 — 테넌트 기본값 설정 (TTS)
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  tts: {
    text: '고객센터 상담원 연결 중입니다. 잠시만 기다려 주세요.',
    provider: 'openai',        // optional
    voice: 'nova',              // optional
  },
});

// 오디오 URL 기반 기본값
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  audioUrl: 'https://cdn.example.com/brand-jingle.mp3',
});

// 기본값 비활성화 (per-DID 설정은 영향 없음)
await gw.setEarlyMediaDefault({ enabled: 'no' });

// 상수로 명시적 지정도 가능 (동일 결과)
await gw.setEarlyMedia(
  DVGatewayClient.EARLY_MEDIA_DEFAULT_EXT,  // = "_default"
  { enabled: 'yes', tts: { text: '기본 안내음' } },
);
```

#### Python

```python
# 편의 메서드 — 테넌트 기본값 조회
default = await gw.get_early_media_default()
print(default["enabled"], default["source"], default["ttsText"], default["fileExists"])

# 편의 메서드 — 테넌트 기본값 설정 (TTS)
await gw.set_early_media_default(
    enabled="yes",
    tts={
        "text": "고객센터 상담원 연결 중입니다. 잠시만 기다려 주세요.",
        "provider": "openai",     # optional
        "voice": "nova",           # optional
    },
)

# 오디오 URL 기반 기본값
await gw.set_early_media_default(
    enabled="yes",
    audio_url="https://cdn.example.com/brand-jingle.mp3",
)

# 기본값 비활성화 (per-DID 설정은 영향 없음)
await gw.set_early_media_default(enabled="no")

# 상수로 명시적 지정도 가능 (동일 결과)
await gw.set_early_media(
    gw.EARLY_MEDIA_DEFAULT_EXT,  # = "_default"
    enabled="yes",
    tts={"text": "기본 안내음"},
)
```

#### 실무 시나리오 — 테넌트 프로비저닝 자동화

```typescript
// 새 테넌트 입주 시 한 번만 호출
async function provisionTenant(tenantId: string, brandName: string) {
  // 1. 테넌트 전체 기본 인사말 등록
  await gw.setEarlyMediaDefault({
    enabled: 'yes',
    tts: {
      text: `${brandName} 고객센터입니다. 잠시만 기다려 주세요.`,
      provider: 'openai',
      voice: 'nova',
    },
  }, tenantId);

  // 2. VIP DID에만 특별 안내음
  await gw.setEarlyMedia('07045144801', {
    enabled: 'yes',
    tts: { text: `${brandName} VIP 고객센터입니다. 최우선으로 응대해 드립니다.` },
  }, tenantId);

  // 수백 개의 나머지 DID는 자동으로 기본 인사말을 사용함 — 추가 작업 불필요
}
```

### 6.3 저장 경로 & 주의사항

| 항목 | Per-DID | 기본값 (`_default`) |
|------|---------|---------------------|
| 파일 경로 | `/var/spool/asterisk/{tenantId}/pa/{DID}/pamsg.wav` | `/var/spool/asterisk/{tenantId}/pa/_default/pamsg.wav` |
| AstDB 키 | `/{tenantId}/earlymedia/{DID}/*` | `/{tenantId}/earlymedia/_default/*` |
| 변환 방식 | 저장 시 1회 ffmpeg 변환 (8kHz mono WAV) | 동일 |
| 다이얼플랜 | `[dvgateway-pa-noa]` 가 자동 폴백 처리 | 동일 |

- 음원은 MP3/OGG/FLAC/WAV 등 어떤 형식이든 **저장 시점에 1회 변환** — 통화마다 재다운로드하지 않음
- TTS 메타데이터 (`text`/`provider`/`voice`)는 AstDB에 저장되어 GET 응답에 포함
- `enabled="no"` 로 설정해도 `ttsText` / `audioUrl` 값은 유지 (재활성화 시 그대로 재사용)
- `_default` 는 **예약어** — 실제 전화번호로는 사용 불가 (밑줄 접두사로 숫자 충돌 방지)

---

## 7. DID별 동시통화 제한하기

DVGateway는 **글로벌(라이선스)** 및 **테넌트별** 동시통화 제한을 제공합니다.
**DID별** 동시통화 제한은 SDK 사용자가 비즈니스 로직으로 구현합니다.

### 왜 DID별 제한은 SDK에서?

| 레벨 | 담당 | 이유 |
|:----:|:----:|------|
| 글로벌 | DVGateway (라이선스) | 인프라 보호 — 서버 과부하 방지 |
| 테넌트별 | DVGateway (TENANT_LIMITS) | 인프라 보호 — 테넌트 간 공정 배분 |
| **DID별** | **SDK 사용자** | **비즈니스 정책** — 고객 요금제, 채널 할당, 초과 시 처리 로직 |

DID별 제한을 DVGateway가 하지 않는 이유:
- DID-채널 매핑은 **고객 요금제**에 따라 다름 (비즈니스 종속)
- 초과 시 처리가 다양함 (거부, 대기큐, 다른 DID 라우팅, 알림 등)
- 고객 요금제 변경마다 DVGateway 재설정이 불필요

### 기본 구현 (Python)

```python
import asyncio
from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import GeminiTtsAdapter

gw = DVGatewayClient(
    base_url="http://localhost:8080",
    auth={"type": "apiKey", "api_key": "dvgw_xxx"},
)

stt = DeepgramAdapter(api_key="dg_xxx", language="ko", model="nova-3")
llm = AnthropicAdapter(api_key="sk-ant-xxx", model="claude-sonnet-4-6",
    system_prompt="친절한 AI 상담원. 1-2문장으로 답변.")
tts = GeminiTtsAdapter(api_key="AIza_xxx")

# ── DID별 동시통화 제한 설정 ────────────────────────────────────────
# 요금제에 따라 DID별 최대 동시통화 수를 설정합니다.
# 실제로는 DB나 설정 파일에서 로드합니다.
did_limits = {
    "07045144801": 3,    # 기본 요금제: 3채널
    "07045144802": 5,    # 비즈니스 요금제: 5채널
    "07045144803": 10,   # 엔터프라이즈 요금제: 10채널
}
DEFAULT_DID_LIMIT = 1    # 미등록 DID 기본값

# ── DID별 활성 통화 추적 ────────────────────────────────────────────
did_active: dict[str, set[str]] = {}  # DID → {linkedId, linkedId, ...}
lock = asyncio.Lock()


async def on_new_call(session):
    """전화 수신 시 — DID별 동시통화 수 체크"""
    did = session.did or "unknown"
    linked_id = session.linked_id
    limit = did_limits.get(did, DEFAULT_DID_LIMIT)

    async with lock:
        active_set = did_active.setdefault(did, set())
        current = len(active_set)

        if current >= limit:
            # ── 초과: 통화 거부 ─────────────────────────────────
            print(f"⛔ [{did}] 동시통화 초과 ({current}/{limit}) — 거부: {session.caller}")
            await gw.say(
                linked_id,
                "현재 통화량이 많아 연결이 어렵습니다. 잠시 후 다시 전화해 주세요.",
                tts,
            )
            await gw.hangup(linked_id)
            return

        # ── 허용: 활성 통화에 추가 ──────────────────────────────
        active_set.add(linked_id)
        print(f"✅ [{did}] 통화 수락 ({current + 1}/{limit}) — {session.caller}")

    # AI 봇 응대 시작
    customer = session.custom_value_1 or "고객"
    await gw.say(linked_id, f"안녕하세요 {customer}님, 무엇을 도와드릴까요?", tts)


async def on_call_ended(linked_id, duration):
    """통화 종료 시 — 활성 통화에서 제거"""
    async with lock:
        for did, active_set in did_active.items():
            if linked_id in active_set:
                active_set.discard(linked_id)
                remaining = len(active_set)
                print(f"📴 [{did}] 통화 종료 ({remaining}/{did_limits.get(did, DEFAULT_DID_LIMIT)}) — {duration}초")
                break


async def main():
    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(on_new_call)
        .on_call_ended(on_call_ended)
        .on_error(lambda err, lid=None: print(f"❌ [{lid}] {err}"))
        .start()
    )

asyncio.run(main())
```

### 실행 결과 예시

```
✅ [07045144801] 통화 수락 (1/3) — 01012345678
✅ [07045144801] 통화 수락 (2/3) — 01098765432
✅ [07045144801] 통화 수락 (3/3) — 01055551234
⛔ [07045144801] 동시통화 초과 (3/3) — 거부: 01033334444
📴 [07045144801] 통화 종료 (2/3) — 45초
✅ [07045144801] 통화 수락 (3/3) — 01033334444
```

### TypeScript 구현

```typescript
const didLimits: Record<string, number> = {
  '07045144801': 3,
  '07045144802': 5,
};
const DEFAULT_DID_LIMIT = 1;
const didActive = new Map<string, Set<string>>();

await gw.pipeline()
  .stt(stt).llm(llm).tts(tts)
  .onNewCall(async (session) => {
    const did = session.did ?? 'unknown';
    const limit = didLimits[did] ?? DEFAULT_DID_LIMIT;
    const activeSet = didActive.get(did) ?? new Set();
    didActive.set(did, activeSet);

    if (activeSet.size >= limit) {
      console.log(`⛔ [${did}] 동시통화 초과 (${activeSet.size}/${limit})`);
      await gw.say(session.linkedId, '현재 통화량이 많습니다. 잠시 후 다시 전화해 주세요.', tts);
      await gw.hangup(session.linkedId);
      return;
    }

    activeSet.add(session.linkedId);
    console.log(`✅ [${did}] 통화 수락 (${activeSet.size}/${limit})`);
    await gw.say(session.linkedId, '안녕하세요, 무엇을 도와드릴까요?', tts);
  })
  .onCallEnded((linkedId, duration) => {
    for (const [did, activeSet] of didActive) {
      if (activeSet.has(linkedId)) {
        activeSet.delete(linkedId);
        const limit = didLimits[did] ?? DEFAULT_DID_LIMIT;
        console.log(`📴 [${did}] 통화 종료 (${activeSet.size}/${limit}) — ${duration}초`);
        break;
      }
    }
  })
  .start();
```

### 고급: 초과 시 대기큐 구현

DID 채널이 가득 찼을 때 즉시 거부하지 않고 **대기큐**에 넣는 패턴:

```python
from collections import deque

# DID별 대기큐
did_queues: dict[str, deque] = {}
QUEUE_MAX = 5       # 최대 대기 인원
QUEUE_TIMEOUT = 30  # 대기 시간(초) 초과 시 자동 거부


async def on_new_call(session):
    did = session.did or "unknown"
    linked_id = session.linked_id
    limit = did_limits.get(did, DEFAULT_DID_LIMIT)

    async with lock:
        active_set = did_active.setdefault(did, set())

        if len(active_set) < limit:
            # 즉시 연결
            active_set.add(linked_id)
            await gw.say(linked_id, "안녕하세요, 연결되었습니다.", tts)
            return

        # 대기큐에 추가
        queue = did_queues.setdefault(did, deque())
        if len(queue) >= QUEUE_MAX:
            await gw.say(linked_id, "대기 인원이 초과되었습니다. 잠시 후 다시 전화해 주세요.", tts)
            await gw.hangup(linked_id)
            return

        queue.append(linked_id)
        position = len(queue)

    await gw.say(
        linked_id,
        f"현재 대기 중입니다. 대기 순번은 {position}번입니다. 잠시만 기다려 주세요.",
        tts,
    )

    # 대기 타임아웃
    await asyncio.sleep(QUEUE_TIMEOUT)
    async with lock:
        queue = did_queues.get(did, deque())
        if linked_id in queue:
            queue.remove(linked_id)
            await gw.say(linked_id, "대기 시간이 초과되었습니다. 잠시 후 다시 전화해 주세요.", tts)
            await gw.hangup(linked_id)


async def on_call_ended(linked_id, duration):
    async with lock:
        for did, active_set in did_active.items():
            if linked_id in active_set:
                active_set.discard(linked_id)

                # 대기큐에서 다음 통화 연결
                queue = did_queues.get(did, deque())
                if queue:
                    next_id = queue.popleft()
                    active_set.add(next_id)
                    print(f"🔔 [{did}] 대기큐에서 연결: {next_id}")
                    await gw.say(next_id, "연결되었습니다. 무엇을 도와드릴까요?", tts)
                break
```

### 고급: DB 기반 DID 제한 관리

실제 서비스에서는 DID별 제한을 DB에서 관리합니다:

```python
# DVGateway 외부 DB API를 활용한 DID 제한 조회
async def load_did_limits():
    """ombutel DB에서 DID별 채널 수 로드"""
    result = await gw._http.post("/api/v1/db/query", {
        "table": "ombu_extensions",
        "limit": 1000,
    })
    limits = {}
    for row in result.data.get("rows", []):
        ext = str(row.get("extension", ""))
        # max_channels 컬럼이 있다고 가정
        max_ch = row.get("max_channels", 1)
        did = f"070{ext}"
        limits[did] = max_ch
    return limits

# 시작 시 로드
did_limits = asyncio.run(load_did_limits())
```

### 동시통화 제한 아키텍처 요약

```
┌─────────────────────────────────────────────────────────┐
│  DVGateway (인프라 보호)                                  │
│                                                         │
│  1단계: 글로벌 제한 (라이선스)                              │
│     └── starter:1  basic:10  standard:50  pro:100       │
│                                                         │
│  2단계: 테넌트별 제한 (TENANT_LIMITS)                      │
│     └── tenantA:20  tenantB:50                          │
│                                                         │
│  통과 → call:new 이벤트 발행 → SDK 봇                      │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│  SDK 봇 (비즈니스 정책)                                    │
│                                                         │
│  3단계: DID별 제한 (SDK 사용자 구현)                        │
│     └── 07045144801:3  07045144802:5  07045144803:10    │
│                                                         │
│  초과 시 처리:                                             │
│     ├── 즉시 거부 (TTS 안내 → hangup)                      │
│     ├── 대기큐 (순번 안내 → 빈 채널 발생 시 연결)             │
│     ├── 다른 DID 라우팅                                    │
│     └── 관리자 알림 (Slack, Email 등)                      │
└─────────────────────────────────────────────────────────┘
```

---

> 상세 REST API 문서: [docs/pbx-management-api.md](../pbx-management-api.md)
> 퀵 매뉴얼: [docs/pbx-quick-reference.md](../pbx-quick-reference.md)
