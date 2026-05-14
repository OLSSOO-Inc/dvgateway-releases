# 14. 신규 테넌트 가이드 — 통화 이벤트 수신 + 고정 음원 재생

> 이 가이드는 **자체 AI(STT·LLM·TTS)를 사용하지 않는 단순 시나리오**를 위한 것입니다.
> 시나리오: "전화가 걸려오면 통화 이벤트(call:new)만 받고, 미리 준비한 고정 음원(WAV/MP3 → PCM)을 발신자에게 들려준다."

대상 독자: 신규 테넌트로 가입한 SaaS 사용자, 간단한 음성안내·ARS·콜드웰컴 메시지 시나리오를 구축하려는 개발자.

---

## 14.1 테넌트와 DID 번호는 어떻게 구분되는가?

### 핵심 사실
**게이트웨이는 DID 번호로 테넌트를 찾지 않습니다.** 테넌트 식별은 **Dynamic VoIP PBX의 다이얼플랜이 결정**하고, 게이트웨이는 `tenantid` 파라미터를 그대로 받기만 합니다.

### 전체 흐름

```
SIP 인바운드 → PBX 다이얼플랜
     │
     │  ${TENANT_PATH} 변수 = 이 DID/트렁크의 소유 테넌트
     │  (PBX 측 라우팅 규칙으로 결정됨)
     │
     ▼
Stasis(dvgateway, ..., tenantid=${TENANT_PATH}, did=${DID_NUMBER}, ...)
     │
     ▼
게이트웨이가 tenantid를 그대로 세션에 저장
  → registry.CallMeta.TenantID
  → callinfo 이벤트의 "tenantId" 필드
  → API 호출 시 JWT의 "tid" 클레임과 비교(RLS)
```

### 다이얼플랜 발췌 (예시)

[go-gateway/cmd/gateway/main.go:2037](go-gateway/cmd/gateway/main.go:2037)에 내장된 표준 예시:

```asterisk
[dvgateway-both]
exten => s,1,NoOp(Dynamic VoIP Gateway — mode=both)
 same => n,Answer()
 same => n,Set(__DID_NUMBER=${IF($["${DID_NUMBER}" != ""]?${DID_NUMBER}:${CALL_DESTINATION})})
 same => n,Set(TENANTID=${TENANT_PATH})      ; multi-tenant ID (custom)
 same => n,Stasis(dvgateway,mode=both,role=autonomous,
                  did=${DID_NUMBER},
                  callernum=${CALLERNUM},
                  callernamename=${CALLERNAME},
                  callednum=${DID_NUMBER},
                  tenantid=${TENANTID},   ; ← 이 값으로 테넌트 결정
                  ...)
```

### 그래서 DID는 어디서 매핑되는가?

PBX 운영자(또는 PBX 관리 UI)가 다음 둘 중 하나로 매핑합니다.

1. **트렁크 → 테넌트**: SIP 트렁크 별로 `${TENANT_PATH}`를 미리 Set.
2. **DID → 테넌트**: 인바운드 라우트(DID별 컨텍스트)에서 `${TENANT_PATH}`를 Set.

예: AstDB(`DB(...)`) 또는 인바운드 라우트 테이블에 `DID_NUMBER` 키로 테넌트를 조회하는 방식이 일반적입니다 ([main.go:2005](go-gateway/cmd/gateway/main.go:2005)의 `DB(${TENANT_PATH}/earlymedia/${DID_NUMBER}/...)` 패턴 참조).

> **요약**: "어떤 번호로 걸려오면 어떤 테넌트인지"는 **PBX 운영자에게 등록**해 두는 정보입니다. 게이트웨이에는 DID 라우팅 테이블이 없습니다. 테넌트로 가입하면 PBX 관리자에게 "이 DID를 내 테넌트(`tenant-acme`)로 라우팅해 달라"고 요청해야 합니다.

### 게이트웨이 측에서 테넌트가 보존되는 위치

| 위치 | 코드 | 설명 |
|------|------|------|
| 세션 등록 | [registry/registry.go:496](go-gateway/internal/registry/registry.go:496) `SetCallMeta()` | Stasis로 받은 `tenantid`를 `CallMeta.TenantID`에 저장 |
| 세션 조회 | [registry/registry.go:600](go-gateway/internal/registry/registry.go:600) `GetCallSessionTenantID()` | linkedID로 테넌트 조회 |
| 이벤트 발행 | [callinfo/hub.go:270](go-gateway/internal/callinfo/hub.go:270) `PublishCallNewFull()` | `call:new` 이벤트에 `tenantId` 포함 |
| 이벤트 필터 | [callinfo/hub.go:686](go-gateway/internal/callinfo/hub.go:686) `broadcast()` | 구독자 JWT의 `tid`와 일치하는 이벤트만 전달 |
| API RLS | [security/rls.go:78](go-gateway/internal/security/rls.go:78) `Wrap()` | 모든 REST/WS 핸들러 진입 시 테넌트 격리 |
| TTS 소유권 | [api/server.go:3363](go-gateway/internal/api/server.go:3363) `tenantOwnsLinkedID()` | TTS 주입 전 "이 linkedID가 내 테넌트의 통화인가" 확인 |

---

## 14.2 인증 — API 키부터 JWT까지

### 1) 사전 등록 정보(테넌트 가입 시 SaaS 운영자로부터 받음)

```
GW_PUBLIC_HOST   : 게이트웨이 공개 호스트 (예: gw.example.com:8080)
TENANT_ID        : 본인 테넌트 ID (예: tenant-acme)
TENANT_PASSWORD  : 본인 테넌트 비밀번호
```

PBX 운영자는 `TENANT_CREDENTIALS="tenant-acme:s3cret,tenant-foo:p@ss"` 형식으로 등록합니다 ([config/config.go:601](go-gateway/internal/config/config.go:601)).

### 2) JWT 발급 — `/login` (대시보드 포트, 8081)

```http
POST http://gw.example.com:8081/login
Content-Type: application/json

{ "tenantId": "tenant-acme", "password": "s3cret" }
```

응답:
```json
{ "token": "eyJhbGciOi...sigInput.sig" }
```

토큰 페이로드(베이스64 디코드):
```json
{ "tid": "tenant-acme", "iat": 1715600000, "exp": 1715686400 }
```

- 유효기간: **24시간** ([dashboard/handler.go:181](go-gateway/internal/dashboard/handler.go:181))
- 서명: HS256, 서버의 `JWT_SECRET`

> **만료 1시간 전쯤에 재발급**하는 클라이언트 로직을 권장합니다.

### 3) SDK 키 흐름(선택)

`/api/v1/auth/token` (API 서버 8080) 엔드포인트는 **SDK API 키 → JWT 교환** 용도이며, 보통 TypeScript/Python SDK가 자동으로 처리합니다. 단순 시나리오에서는 `/login` 한 번이면 충분합니다.

---

## 14.3 callinfo 이벤트 수신 — WebSocket

### 연결

```
ws://gw.example.com:8080/api/v1/ws/callinfo
Authorization: Bearer <JWT>
```

(브라우저처럼 헤더를 못 보내는 환경이면 `?token=<JWT>` 쿼리 파라미터도 지원합니다 — 표준 패턴이지만 보안상 헤더 권장.)

### 받는 이벤트 스키마

[callinfo/hub.go:35-82](go-gateway/internal/callinfo/hub.go:35) 기준:

```json
{
  "event": "call:new",
  "linkedId": "1715600123.456",
  "mode": "both",
  "dir": "both",
  "did": "025550100",
  "callid": "ABCD-1234",
  "agentNumber": "1001",
  "caller": "01012345678",
  "callerName": "Hong Gildong",
  "callee": "025550100",
  "tenantId": "tenant-acme",
  "serverId": "gw-seoul-1",
  "customValue1": "...",
  "customValue2": "...",
  "customValue3": "...",
  "streams": {
    "both": "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1715600123.456&dir=both"
  },
  "streamUrl": "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1715600123.456&dir=both",
  "startedAt": "2026-05-14T01:35:23Z"
}
```

이벤트 종류:
| event | 시점 |
|-------|------|
| `call:new` | 인바운드/아웃바운드 통화 시작 |
| `call:ended` | 통화 종료 |
| `tts:playback` | TTS 재생 상태(start/stop) — 본인이 시작한 TTS만 |
| (기타 회의/캠페인 이벤트) | 본 가이드 범위 외 |

### 테넌트 자동 격리

서버가 JWT의 `tid`와 이벤트의 `tenantId`를 비교해 **본인 테넌트 이벤트만** 보냅니다 ([callinfo/hub.go:686](go-gateway/internal/callinfo/hub.go:686)). 클라이언트 측 필터링 불필요.

### 최소 구현 예시 (Node.js)

```js
import WebSocket from 'ws';

const TOKEN = process.env.GW_JWT;        // /login으로 받은 JWT
const HOST  = 'gw.example.com:8080';

const ws = new WebSocket(`ws://${HOST}/api/v1/ws/callinfo`, {
  headers: { Authorization: `Bearer ${TOKEN}` }
});

ws.on('message', async (raw) => {
  const evt = JSON.parse(raw.toString());

  if (evt.event === 'call:new') {
    console.log(`[CALL] linkedid=${evt.linkedId} did=${evt.did} from=${evt.caller}`);
    await playFixedAudio(evt.linkedId, evt.did);   // ↓ 다음 절
  }

  if (evt.event === 'call:ended') {
    console.log(`[END]  linkedid=${evt.linkedId} duration=${evt.duration}s`);
  }
});

ws.on('close',  () => setTimeout(reconnect, 2000));
ws.on('error',  (err) => console.error('[CALLINFO]', err));
```

### Python 예시

```python
import asyncio, json, os, websockets

TOKEN = os.environ["GW_JWT"]
HOST  = "gw.example.com:8080"

async def main():
    async with websockets.connect(
        f"ws://{HOST}/api/v1/ws/callinfo",
        extra_headers={"Authorization": f"Bearer {TOKEN}"},
    ) as ws:
        async for raw in ws:
            evt = json.loads(raw)
            if evt["event"] == "call:new":
                print(f"[CALL] {evt['linkedId']} did={evt.get('did')} from={evt.get('caller')}")
                await play_fixed_audio(evt["linkedId"], evt.get("did"))

asyncio.run(main())
```

---

## 14.4 고정 음원 재생 — TTS Inject 엔드포인트

### 오디오 포맷 — **이것만 받습니다**

- **slin16** = 16,000 Hz, 16-bit, mono, **little-endian**, 헤더 없는 raw PCM
- WAV/MP3/Opus는 **사전에 변환**해서 보내야 합니다.

### 변환 한 줄 (ffmpeg)

```bash
ffmpeg -y -i welcome.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le welcome.pcm
```

결과는 `welcome.pcm` (raw PCM). 가입 시 자주 쓰는 음원은 미리 변환해서 디스크에 캐시해 두세요.

### 두 가지 재생 방법

#### A) HTTP POST (가장 간단, 짧은 음원에 적합)

[api/server.go:1650](go-gateway/internal/api/server.go:1650) `handleTTSPlay()`

```http
POST http://gw.example.com:8080/api/v1/tts/{linkedId}
Authorization: Bearer <JWT>
Content-Type: application/octet-stream
X-Inject-Id: welcome-001        # (선택) 재생 ID. 미지정 시 자동 UUID

<raw PCM 바이트>
```

응답 상태:
| 코드 | 의미 |
|------|------|
| 200 | 재생 시작/완료 |
| 403 | 이 통화는 내 테넌트 소유가 아님 |
| 404 | 활성 통화 없음(linkedID가 종료됨/없음) |
| 503 | TTS 기능 비활성(라이선스 미보유) |

```bash
curl -X POST \
  -H "Authorization: Bearer $GW_JWT" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @welcome.pcm \
  "http://gw.example.com:8080/api/v1/tts/$LINKED_ID"
```

#### B) WebSocket 스트리밍 (긴 음원, 청크 전송)

```
ws://gw.example.com:8080/api/v1/ws/tts/{linkedId}
Authorization: Bearer <JWT>
```

바이너리 프레임으로 PCM을 청크 단위로 보냅니다(예: 20ms = 640바이트). 짧은 안내음에는 A 방식이 더 단순합니다.

### Node.js 구현 — call:new에 반응해서 재생

```js
import fs from 'node:fs';
import fetch from 'node-fetch';

// did별로 미리 변환해 둔 PCM 파일 매핑
const AUDIO_BY_DID = {
  '025550100': '/var/lib/myapp/welcome-acme.pcm',
  '025550200': '/var/lib/myapp/welcome-after-hours.pcm',
};
const DEFAULT_AUDIO = '/var/lib/myapp/welcome-default.pcm';

async function playFixedAudio(linkedId, did) {
  const file = AUDIO_BY_DID[did] || DEFAULT_AUDIO;
  const pcm  = fs.readFileSync(file);

  const res = await fetch(`http://${HOST}/api/v1/tts/${linkedId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/octet-stream',
      'X-Inject-Id':   `welcome-${linkedId}`,
    },
    body: pcm,
  });

  if (!res.ok) {
    console.error(`[TTS] play failed linkedid=${linkedId} status=${res.status}`);
  }
}
```

### Python 구현

```python
import os, requests

AUDIO_BY_DID = {
    "025550100": "/var/lib/myapp/welcome-acme.pcm",
}
DEFAULT_AUDIO = "/var/lib/myapp/welcome-default.pcm"

async def play_fixed_audio(linked_id: str, did: str | None):
    path = AUDIO_BY_DID.get(did or "", DEFAULT_AUDIO)
    with open(path, "rb") as f:
        pcm = f.read()

    r = requests.post(
        f"http://{HOST}/api/v1/tts/{linked_id}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type":  "application/octet-stream",
            "X-Inject-Id":   f"welcome-{linked_id}",
        },
        data=pcm,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"[TTS] play failed linkedid={linked_id} status={r.status_code}")
```

### 재생 도중 중단

```http
DELETE /api/v1/tts/{linkedId}
Authorization: Bearer <JWT>
```

### 상태 조회

```http
GET /api/v1/tts/{linkedId}/status
```

---

## 14.5 전체 흐름 정리 — "전화 오면 환영 메시지"

```
[1] 클라이언트 부팅
    ├─ POST :8081/login → JWT 획득
    └─ WebSocket :8080/api/v1/ws/callinfo (Bearer JWT) 연결

[2] 사용자가 025-555-0100 으로 전화
    └─ PBX 다이얼플랜이 tenantid=tenant-acme로 Stasis 호출

[3] 게이트웨이 → 클라이언트
    └─ {"event":"call:new","linkedId":"...","did":"025550100","tenantId":"tenant-acme",...}

[4] 클라이언트
    └─ DID로 음원 선택 → POST :8080/api/v1/tts/{linkedId} (PCM body)

[5] 게이트웨이
    └─ PCM을 fade-in/fade-out과 함께 통화 채널에 주입

[6] 통화 종료
    └─ {"event":"call:ended","linkedId":"...","duration":12}
```

---

## 14.6 자주 묻는 질문(FAQ)

**Q1. 한 테넌트가 여러 DID를 가질 수 있나요?**
네. PBX 인바운드 라우트마다 `${TENANT_PATH}`를 같은 값으로 Set하면 됩니다. 게이트웨이는 DID에 신경 쓰지 않습니다.

**Q2. DID가 어느 테넌트에 속하는지 코드에서 알아낼 수 있나요?**
이벤트의 `did` + `tenantId`를 보면 됩니다. 사전에 매핑하고 싶다면 **본인 애플리케이션에서** `did → 음원` 매핑 테이블을 관리하세요(위 예시의 `AUDIO_BY_DID`처럼).

**Q3. 다른 테넌트의 통화 이벤트를 받을 위험이 있나요?**
없습니다. 서버가 JWT의 `tid`로 자동 필터링합니다 ([callinfo/hub.go:686](go-gateway/internal/callinfo/hub.go:686)).
또한 다른 테넌트의 linkedID로 `/api/v1/tts/...`를 호출해도 `403 Forbidden` ([api/server.go:3363](go-gateway/internal/api/server.go:3363)).

**Q4. 음원 형식이 잘못되면 어떻게 되나요?**
slin16(16k/16-bit/mono/LE)이 아닌 raw 바이트를 보내면 잡음/속도 이상으로 재생됩니다. 항상 `ffmpeg -ar 16000 -ac 1 -f s16le`로 변환하세요.

**Q5. 동일 통화에 연속으로 음원을 보내려면?**
이전 재생이 끝난 뒤(또는 `DELETE` 후) 다음 `POST`를 보내세요. 동시 호출은 상위 호출이 덮어씁니다.

**Q6. 클라우드 TTS로 텍스트→음성을 쓸 수 있나요?**
가능합니다. `/api/v1/tts/synthesize`로 텍스트를 보내면 서버가 PCM을 합성해 줍니다(테넌트 라이선스에 `tts` 피처 필요). 본 가이드의 단순 시나리오에서는 고정 음원 캐시 방식이 비용·지연 면에서 유리합니다.

**Q7. 재연결 전략은?**
WebSocket `close`/`error` 시 지수 백오프(2초→4초→8초→최대 30초)로 재연결하고, 재연결 직후 JWT 만료를 확인해 필요하면 `/login` 재호출. 통화 이벤트를 놓치지 않으려면 클라이언트는 항상 살아 있어야 합니다.

**Q8. 운영용 체크리스트**
- [ ] PBX 운영자에게 DID → `TENANT_PATH=tenant-acme` 매핑 요청 완료
- [ ] `TENANT_CREDENTIALS`에 본인 테넌트 등록 확인
- [ ] 음원 PCM 변환 후 디스크에 캐시
- [ ] callinfo WS 재연결 로직 구현
- [ ] JWT 만료 23시간 후 재발급 스케줄
- [ ] 403/404/503 에러 처리 분기 작성

---

## 14.7 참고 파일 한 줄 색인

| 주제 | 파일 |
|------|------|
| 다이얼플랜 예시 | [go-gateway/cmd/gateway/main.go:2018-2090](go-gateway/cmd/gateway/main.go:2018) |
| 테넌트 자격증명 파서 | [go-gateway/internal/config/config.go:601](go-gateway/internal/config/config.go:601) |
| JWT 발급 | [go-gateway/internal/dashboard/handler.go:181](go-gateway/internal/dashboard/handler.go:181) |
| JWT 검증 (RLS) | [go-gateway/internal/security/rls.go:78](go-gateway/internal/security/rls.go:78) |
| callinfo 이벤트 스키마 | [go-gateway/internal/callinfo/hub.go:35](go-gateway/internal/callinfo/hub.go:35) |
| 테넌트 격리 브로드캐스트 | [go-gateway/internal/callinfo/hub.go:686](go-gateway/internal/callinfo/hub.go:686) |
| TTS HTTP Inject 핸들러 | [go-gateway/internal/api/server.go:1650](go-gateway/internal/api/server.go:1650) |
| 테넌트 소유권 검사 | [go-gateway/internal/api/server.go:3363](go-gateway/internal/api/server.go:3363) |
| 세션 레지스트리 | [go-gateway/internal/registry/registry.go:496](go-gateway/internal/registry/registry.go:496) |

---

## 14.8 가장 쉬운 콜 이벤트 수신 확인 — 5분 안에 끝내기

> **이 절의 목표**: SaaS 운영자에게 받은 **3개 정보만** 가지고, 코드 한 줄 없이 터미널에서 전화 이벤트가 도착하는지 눈으로 확인합니다.

### 준비물 — 운영자에게 받았는지 확인하세요

| 항목 | 예시 값 | 설명 |
|------|---------|------|
| 게이트웨이 호스트 | `gw.example.com` | 도메인 또는 IP |
| 테넌트 ID | `tenant-acme` | 본인 테넌트 식별자 |
| 테넌트 비밀번호 | `s3cret` | `/login` 인증용 |

> 이 3개가 없으면 SaaS 담당자에게 "콜 이벤트 수신 테스트를 위해 게이트웨이 주소, 테넌트 ID, 테넌트 비밀번호를 알려 주세요"라고 요청하세요.

### 사전 설치 — 한 번만

WebSocket을 터미널에서 보려면 둘 중 하나가 필요합니다.

```bash
# macOS — Homebrew
brew install websocat            # 권장 (단일 바이너리)

# 또는 npm 환경
npm install -g wscat
```

`curl`은 macOS·Linux에 기본 설치되어 있습니다.

---

### Step 1 — JWT 토큰 받기 (curl 한 번)

`HOST`/`TID`/`PW`를 본인 값으로 바꿔서 그대로 붙여넣으세요.

```bash
HOST=gw.example.com
TID=tenant-acme
PW=s3cret

TOKEN=$(curl -s -X POST "http://$HOST:8081/login" \
  -H 'Content-Type: application/json' \
  -d "{\"tenantId\":\"$TID\",\"password\":\"$PW\"}" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')

echo "$TOKEN"
```

성공 시 `eyJhbGciOi...` 같은 긴 문자열이 출력됩니다.
이 값이 안 보이면 → **Step 1 트러블슈팅** (아래 14.9)로.

> TLS(https)가 켜진 운영 환경이면 `http://` → `https://`, `ws://` → `wss://`로만 바꾸면 됩니다.

---

### Step 2 — 빈 통화 목록인지 한 번 확인 (선택)

서버가 살아있고 토큰이 유효한지 가벼운 헬스 체크:

```bash
curl -s "http://$HOST:8080/api/v1/sessions" \
  -H "Authorization: Bearer $TOKEN"
```

응답이 `[]` 또는 `{...}`로 오면 인증 OK. `401`이면 토큰 문제, `404`면 호스트/포트 문제입니다.

---

### Step 3 — 콜 이벤트 WebSocket 열기

#### A) websocat (권장)

```bash
websocat "ws://$HOST:8080/api/v1/ws/callinfo?token=$TOKEN"
```

#### B) wscat

```bash
wscat -c "ws://$HOST:8080/api/v1/ws/callinfo" \
      -H "Authorization: Bearer $TOKEN"
```

> 쿼리 파라미터 `?token=`도 서버가 받아줍니다 ([security/rls.go:96](go-gateway/internal/security/rls.go:96)) — 헤더 못 넣는 도구일 때 사용.

연결되면 터미널이 **그냥 멈춰 있는 것처럼** 보입니다. 정상입니다. 이벤트를 기다리는 중입니다.

---

### Step 4 — 본인 테넌트 DID로 전화 걸기

운영자가 본인 테넌트로 매핑해 준 DID(예: `025550100`)로 휴대폰에서 전화를 겁니다.

전화가 울리는 순간 터미널에 아래와 비슷한 JSON이 한 줄 뜹니다:

```json
{"event":"call:new","linkedId":"1715600123.456","mode":"both","dir":"both","did":"025550100","caller":"01012345678","callerName":"Hong Gildong","callee":"025550100","tenantId":"tenant-acme","serverId":"gw-seoul-1","streams":{"both":"ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1715600123.456&dir=both"},"streamUrl":"ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1715600123.456&dir=both","startedAt":"2026-05-14T01:35:23Z"}
```

통화를 끊으면:

```json
{"event":"call:ended","linkedId":"1715600123.456","duration":7}
```

이 두 줄을 봤다면 **수신 확인 완료**입니다. 이제 14.4의 TTS 주입으로 넘어가면 됩니다.

---

### Step 5 — 보기 좋게 정리하기 (선택)

`jq`가 있으면 한 줄짜리 JSON이 예쁘게 보입니다:

```bash
websocat "ws://$HOST:8080/api/v1/ws/callinfo?token=$TOKEN" | jq -c '{event,linkedId,did,caller,tenantId}'
```

출력:
```
{"event":"call:new","linkedId":"1715600123.456","did":"025550100","caller":"01012345678","tenantId":"tenant-acme"}
{"event":"call:ended","linkedId":"1715600123.456","did":null,"caller":null,"tenantId":null}
```

---

## 14.9 트러블슈팅 — 이벤트가 안 보일 때

증상별로 위에서 아래 순서로 점검하세요.

### A. Step 1에서 `$TOKEN`이 빈 값

```bash
# 원본 응답을 그대로 확인 (반드시 8081 포트)
curl -i -X POST "http://$HOST:8081/login" \
  -H 'Content-Type: application/json' \
  -d "{\"tenantId\":\"$TID\",\"password\":\"$PW\"}"
```

> ⚠ `/login`은 **대시보드 포트(8081)** 입니다. API 포트(8080)로 잘못 보낸 경우 404가 옵니다.

| 응답 | 원인 | 조치 |
|------|------|------|
| `404 Not Found` | 포트 오타 / 호스트 오타 | 포트가 8081인지 확인 |
| `401 Unauthorized` | 비밀번호 틀림 | 운영자에게 재확인 |
| `400 Bad Request` | JSON 본문 형식 오류 | 따옴표 이스케이프 확인 |
| 연결 거부 / 타임아웃 | 방화벽 / 다른 망 | 운영자에게 8080·8081 인바운드 개방 확인 |

### B. Step 3 WebSocket 연결은 되는데 이벤트가 안 옴

1. **테넌트 DID가 맞는지 확인** — 운영자에게 "내 테넌트(`tenant-acme`)로 라우팅된 DID 번호를 알려 달라"고 재요청. 다른 테넌트의 번호로 걸면 본인 WS로는 절대 안 옵니다 ([callinfo/hub.go:686](go-gateway/internal/callinfo/hub.go:686)).
2. **PBX 다이얼플랜에 `Set(TENANTID=...)`이 있는지** 운영자에게 확인. 누락되면 이벤트는 발생하지만 `tenantId` 필드가 비어 → 본인 WS로는 안 옵니다.
3. **/health 체크**:
   ```bash
   curl -s "http://$HOST:8080/health"
   ```
   `ok`/`{"status":"ok"}` 이외 응답이면 운영자에게 게이트웨이 상태 확인 요청.

### C. WebSocket이 바로 끊김 (`1006`, `unexpected EOF`)

- `?token=`을 URL에 안 넣었거나 토큰이 만료(24시간)된 경우. **Step 1 재실행**.
- 프록시(nginx 등)가 WS 업그레이드를 막는 환경 — 운영자에게 `Upgrade`/`Connection` 헤더 패스스루 확인.

### D. `call:new`는 오는데 `tenantId`가 비어 있음

PBX 다이얼플랜에서 `Set(TENANTID=${TENANT_PATH})`이 누락된 상태입니다. 운영자에게 14.1절의 다이얼플랜 예시를 보여 주고 추가 요청하세요. 이 경우 본인 테넌트로 가입했어도 이벤트를 받지 못합니다.

---

## 14.10 한 줄 요약 — 운영자에게 보낼 체크리스트 템플릿

콜 이벤트 수신 테스트를 위해 운영자에게 보낼 메시지 예시:

```
[테넌트 가입 확인 요청]
- 테넌트 ID:        tenant-acme
- 테스트할 DID:     025-555-0100
- 게이트웨이 호스트: gw.example.com (포트 8080/8081 인바운드 개방 필요)

확인 부탁드립니다:
1) TENANT_CREDENTIALS 에 tenant-acme 등록되었나요?
2) DID 025-555-0100 인바운드 라우트의 다이얼플랜에
   Set(TENANTID=tenant-acme) 가 들어가 있나요?
3) Set(TENANTID=...) 직후 Stasis(dvgateway,...,tenantid=${TENANTID},...) 호출이
   포함되어 있나요?

위 3가지가 모두 되어 있으면, 본인 휴대폰에서 025-555-0100으로 전화 시
WebSocket /api/v1/ws/callinfo 에 call:new 이벤트가 도착해야 합니다.
```

