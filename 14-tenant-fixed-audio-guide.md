# 14. 신규 테넌트 가이드 — 통화 이벤트 수신 + 고정 음원 재생

> **대상**: SaaS DVGateway 테넌트로 가입한 개발자
> **시나리오**: "전화가 걸려오면 통화 이벤트를 받고, 미리 준비한 고정 음원(WAV/MP3 → PCM)을 발신자에게 들려준다." 자체 STT/LLM/TTS는 사용하지 않는 단순한 ARS·콜드웰컴·고정 안내 시나리오.
>
> 이 가이드는 사용자가 **직접 입력하거나 호출하는 내용만** 다룹니다. 게이트웨이 내부 동작이나 PBX 다이얼플랜 설정은 SaaS 운영자가 처리하므로 본 문서에서는 다루지 않습니다.

---

## 14.1 가입 시 받게 되는 정보

테넌트로 가입하면 SaaS 운영자가 다음 3가지를 발급해 줍니다.

| 항목 | 예시 값 | 용도 |
|------|---------|------|
| 게이트웨이 호스트 | `gw.example.com` | API/WebSocket 연결 주소 (도메인 또는 IP) |
| 테넌트 ID | `tenant-acme` | 본인 테넌트 식별자 |
| 테넌트 비밀번호 | `s3cret` | JWT 발급용 |

추가로 **본인 테넌트로 라우팅된 DID 번호**(예: `02-555-0100`)도 함께 받습니다. 그 번호로 전화가 오면 본인 클라이언트가 이벤트를 받게 됩니다.

> 위 3개 중 하나라도 없으면 운영자에게 요청하세요. 다음 절의 모든 명령이 이 값들을 그대로 사용합니다.

---

## 14.2 API/포트 구조 한눈에

| 포트 | 용도 | 프로토콜 |
|------|------|---------|
| `8081` | JWT 토큰 발급 (`/login`) | HTTP |
| `8080` | 통화 이벤트 WebSocket + TTS 주입 REST | HTTP / WebSocket |

테스트 환경은 `http://` / `ws://`, 운영 환경은 `https://` / `wss://`를 사용하세요. 그 외에는 동일합니다.

---

## 14.3 인증 — JWT 토큰 받기

### 발급

```http
POST http://gw.example.com:8081/login
Content-Type: application/json

{ "tenantId": "tenant-acme", "password": "s3cret" }
```

응답:

```json
{ "token": "eyJhbGciOi...sigInput.sig" }
```

### curl 예시 (한 줄로 환경 변수에 담기)

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

성공하면 `eyJhbGciOi...` 같은 긴 문자열이 출력됩니다.

### 토큰 특성

- **유효기간 24시간** — 만료 1시간 전쯤에 재발급하는 로직을 권장합니다.
- 페이로드를 디코드하면 본인 테넌트가 보입니다:
  ```bash
  echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null
  # {"tid":"tenant-acme","iat":1715600000,"exp":1715686400}
  ```
- **다른 테넌트의 이벤트나 통화는 절대 받을 수 없습니다** (서버가 자동 격리).

---

## 14.4 통화 이벤트 수신 — WebSocket

### 연결

```
ws://gw.example.com:8080/api/v1/ws/callinfo
Authorization: Bearer <JWT>
```

브라우저처럼 헤더를 못 보내는 환경이면 쿼리 파라미터로도 인증 가능합니다.

```
ws://gw.example.com:8080/api/v1/ws/callinfo?token=<JWT>
```

### 받는 이벤트 종류

| event | 시점 | 핵심 필드 |
|-------|------|----------|
| `snapshot` | 연결 직후 1회 | (활성 통화 목록 — 보통 비어 있음) |
| `call:new` | 전화가 시작될 때 | `linkedId`, `did`, `caller`, `callerName`, `callee` |
| `channel:state` | 채널 상태 변화 (벨 울림/응답/종료/실패) | `linkedId`, `leg`, `state`, `direction` |
| `call:ended` | 통화 종료 | `linkedId`, `duration` |
| `tts:playback` | 본인이 시작한 TTS 재생 상태 | `linkedId`, `injectId`, `phase` |
| `tts:complete` | 본인이 시작한 TTS 재생 완료 | `linkedId` |

### call:new 이벤트 예시 (인입 통화)

```json
{
  "event": "call:new",
  "linkedId": "1778748883.1007",
  "mode": "both",
  "dir": "both",
  "did": "07045144820",
  "callid": "1778748883.1007",
  "caller": "01026132471",
  "callerName": "홍길동",
  "callee": "07045144820",
  "tenantId": "tenant-acme",
  "serverId": "gw-seoul-1",
  "streams": {
    "both": "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1778748883.1007&dir=both",
    "in":   "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1778748883.1007&dir=in",
    "out":  "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1778748883.1007&dir=out"
  },
  "streamUrl": "ws://gw.example.com:8080/api/v1/ws/stream?linkedid=1778748883.1007&dir=both",
  "startedAt": "2026-05-14T08:54:43Z"
}
```

**가장 중요한 필드**:
- `linkedId` — 이 통화의 고유 ID. TTS 주입 등 후속 API 호출에 이 값을 사용합니다.
- `did` — 어떤 번호로 걸려왔는지. 여러 DID를 받고 있다면 시나리오 분기에 사용.
- `caller` — 발신자 번호.

### channel:state 이벤트 예시

벨이 울릴 때:
```json
{ "event": "channel:state", "linkedId": "...", "leg": "a", "state": "ring", "direction": "inbound", ... }
```

발신자가 받았을 때:
```json
{ "event": "channel:state", "linkedId": "...", "leg": "a", "state": "up", "direction": "inbound", ... }
```

`state`는 `ring → up → down` (또는 `ring → busy/no_answer/rejected`) 순서. TTS는 보통 `state="up"` 시점에 주입합니다.

`direction`:
- `inbound` — 외부에서 걸려온 통화
- `outbound` — 캠페인/click-to-call로 발신한 통화

### call:ended 이벤트

```json
{ "event": "call:ended", "linkedId": "...", "duration": 32 }
```

`duration`은 초 단위.

---

## 14.5 5분 안에 수신 확인 — 코드 없이

운영자가 본인 테넌트로 라우팅해준 DID로 휴대폰에서 전화를 걸어 이벤트가 도착하는지 터미널에서 직접 보세요.

### 사전 설치

```bash
# macOS — Homebrew
brew install websocat       # 권장 (단일 바이너리)

# 또는
npm install -g wscat
```

### 한 줄 실행 (위 14.3에서 `$TOKEN`을 받았다고 가정)

```bash
websocat "ws://$HOST:8080/api/v1/ws/callinfo?token=$TOKEN"
```

또는:

```bash
wscat -c "ws://$HOST:8080/api/v1/ws/callinfo" \
      -H "Authorization: Bearer $TOKEN"
```

연결되면 터미널이 멈춘 듯 보입니다 (이벤트 대기 상태). 본인 DID로 전화를 걸면 위 14.4의 JSON들이 차례로 흘러옵니다.

### `jq`로 깔끔하게 보기

```bash
websocat "ws://$HOST:8080/api/v1/ws/callinfo?token=$TOKEN" \
  | jq -c '{event,linkedId,did,caller,state}'
```

출력:
```
{"event":"snapshot","linkedId":null,"did":null,"caller":null,"state":null}
{"event":"channel:state","linkedId":"1778748883.1007","did":null,"caller":null,"state":"ring"}
{"event":"call:new","linkedId":"1778748883.1007","did":"07045144820","caller":"01026132471","state":null}
{"event":"channel:state","linkedId":"1778748883.1007","did":null,"caller":null,"state":"up"}
{"event":"call:ended","linkedId":"1778748883.1007","did":null,"caller":null,"state":null}
```

여기까지 보이면 수신 확인 완료입니다.

---

## 14.6 고정 음원 재생 — TTS 주입

### 오디오 포맷 — 이것만 받습니다

- **slin16** = 16,000 Hz, 16-bit, mono, **little-endian**, 헤더 없는 raw PCM

WAV/MP3/Opus는 **사전에 변환**해 두세요.

### 변환 한 줄 (ffmpeg)

```bash
ffmpeg -y -i welcome.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le welcome.pcm
```

자주 쓰는 음원은 미리 변환해서 디스크에 캐시합니다.

### 두 가지 재생 방법

#### A) HTTP POST (가장 간단)

```http
POST http://gw.example.com:8080/api/v1/tts/{linkedId}
Authorization: Bearer <JWT>
Content-Type: application/octet-stream
X-Inject-Id: welcome-001        (선택) 재생 ID. 미지정 시 자동 UUID

<raw PCM 바이트>
```

curl:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @welcome.pcm \
  "http://$HOST:8080/api/v1/tts/$LINKED_ID"
```

#### B) WebSocket 스트리밍 (긴 음원, 청크 전송)

```
ws://gw.example.com:8080/api/v1/ws/tts/{linkedId}
Authorization: Bearer <JWT>
```

바이너리 프레임으로 PCM을 청크 단위로 보냅니다(예: 20ms = 640바이트). 짧은 안내음에는 A 방식이 더 단순합니다.

### 응답 상태

| 코드 | 의미 | 조치 |
|------|------|------|
| 200 | 재생 완료 | 정상 |
| 403 | 이 통화는 내 테넌트 소유가 아님 | linkedId 확인 |
| 404 | 활성 통화 없음 | linkedId가 이미 종료됐을 가능성 |
| 503 | TTS 기능 비활성 | 운영자에게 라이선스 확인 요청 |

### 재생 중단

```http
DELETE /api/v1/tts/{linkedId}
Authorization: Bearer <JWT>
```

### 상태 조회

```http
GET /api/v1/tts/{linkedId}/status
Authorization: Bearer <JWT>
```

---

## 14.7 최소 클라이언트 예시

### Node.js

```js
import fs from 'node:fs';
import WebSocket from 'ws';
import fetch from 'node-fetch';

const HOST  = 'gw.example.com';
const TOKEN = process.env.GW_JWT;        // 14.3에서 받은 JWT

// did → 음원 매핑 (미리 ffmpeg로 변환된 slin16 PCM)
const AUDIO_BY_DID = {
  '07045144820': '/var/lib/myapp/welcome-acme.pcm',
};
const DEFAULT_AUDIO = '/var/lib/myapp/welcome-default.pcm';

async function playFixedAudio(linkedId, did) {
  const file = AUDIO_BY_DID[did] || DEFAULT_AUDIO;
  const pcm  = fs.readFileSync(file);

  const res = await fetch(`http://${HOST}:8080/api/v1/tts/${linkedId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/octet-stream',
      'X-Inject-Id':   `welcome-${linkedId}`,
    },
    body: pcm,
  });

  if (!res.ok) console.error(`[TTS] play failed status=${res.status}`);
}

const ws = new WebSocket(`ws://${HOST}:8080/api/v1/ws/callinfo`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});

ws.on('message', async (raw) => {
  const evt = JSON.parse(raw.toString());

  if (evt.event === 'call:new') {
    console.log(`[CALL] linkedid=${evt.linkedId} did=${evt.did} from=${evt.caller}`);
    await playFixedAudio(evt.linkedId, evt.did);
  }

  if (evt.event === 'call:ended') {
    console.log(`[END]  linkedid=${evt.linkedId} duration=${evt.duration}s`);
  }
});

ws.on('close',  () => console.log('disconnected — reconnect with backoff'));
ws.on('error',  (err) => console.error('[CALLINFO]', err));
```

### Python

```python
import asyncio, json, os, requests, websockets

HOST  = "gw.example.com"
TOKEN = os.environ["GW_JWT"]

AUDIO_BY_DID = {
    "07045144820": "/var/lib/myapp/welcome-acme.pcm",
}
DEFAULT_AUDIO = "/var/lib/myapp/welcome-default.pcm"

def play_fixed_audio(linked_id: str, did: str | None):
    path = AUDIO_BY_DID.get(did or "", DEFAULT_AUDIO)
    with open(path, "rb") as f:
        pcm = f.read()
    r = requests.post(
        f"http://{HOST}:8080/api/v1/tts/{linked_id}",
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

async def main():
    async with websockets.connect(
        f"ws://{HOST}:8080/api/v1/ws/callinfo",
        extra_headers={"Authorization": f"Bearer {TOKEN}"},
    ) as ws:
        async for raw in ws:
            evt = json.loads(raw)
            if evt["event"] == "call:new":
                print(f"[CALL] {evt['linkedId']} did={evt.get('did')} from={evt.get('caller')}")
                play_fixed_audio(evt["linkedId"], evt.get("did"))
            elif evt["event"] == "call:ended":
                print(f"[END]  {evt['linkedId']} duration={evt['duration']}s")

asyncio.run(main())
```

---

## 14.8 전체 흐름 정리

```
[1] 클라이언트 부팅
    ├─ POST :8081/login → JWT 획득 (24h)
    └─ WebSocket :8080/api/v1/ws/callinfo (Bearer JWT) 연결

[2] 사용자가 본인 테넌트 DID로 전화
    └─ 게이트웨이 → 클라이언트
       {"event":"call:new","linkedId":"...","did":"...","caller":"...","tenantId":"..."}

[3] 클라이언트
    └─ DID로 음원 선택 → POST :8080/api/v1/tts/{linkedId} (PCM body)

[4] 게이트웨이가 PCM을 통화 채널에 주입 (fade-in/out 자동)

[5] 통화 종료
    └─ {"event":"call:ended","linkedId":"...","duration":12}
```

---

## 14.9 자주 묻는 질문(FAQ)

**Q1. 한 테넌트가 여러 DID를 가질 수 있나요?**
네. 본인 테넌트로 매핑된 모든 DID로 걸려온 통화는 같은 WebSocket으로 들어옵니다. `event.did`로 어떤 번호로 걸려왔는지 분기하세요.

**Q2. 다른 테넌트의 통화 이벤트를 받을 위험은?**
없습니다. 서버가 JWT의 테넌트 ID로 자동 필터링합니다. 다른 테넌트의 linkedId로 TTS API를 호출해도 `403 Forbidden`.

**Q3. 음원 형식이 잘못되면 어떻게 되나요?**
slin16(16k/16-bit/mono/LE)이 아닌 raw 바이트를 보내면 잡음·속도 이상으로 재생됩니다. 항상 `ffmpeg -ar 16000 -ac 1 -f s16le`로 변환하세요.

**Q4. 동일 통화에 연속으로 음원을 보내려면?**
이전 재생이 끝난 뒤(또는 `DELETE` 후) 다음 `POST`를 보내세요. 진행 중에 다시 POST하면 새 음원이 이전을 대체합니다(preempt).

**Q5. TTS가 안 들립니다.**
- 4xx 응답이면 위 14.6 응답 코드 표 참조.
- 200인데 안 들리면 PCM 포맷 의심 (위 Q3).
- `call:new` 받기 전이거나 `call:ended` 후에 호출하면 404.

**Q6. 재연결 전략은?**
WebSocket `close`/`error` 시 지수 백오프(2초→4초→8초→최대 30초)로 재연결하고, 재연결 직후 JWT 만료를 확인해 필요하면 `/login` 재호출. 통화 이벤트를 놓치지 않으려면 클라이언트는 항상 살아 있어야 합니다.

**Q7. 운영 환경 체크리스트**
- [ ] 운영자에게 호스트·테넌트ID·비밀번호·DID 4가지 모두 받음
- [ ] 본인 DID로 전화 → `call:new` 이벤트 도착 확인
- [ ] 음원을 미리 PCM(slin16)으로 변환해 캐시
- [ ] WebSocket 재연결 + JWT 자동 재발급 로직 작성
- [ ] 403/404/503 에러 분기 처리

---

## 14.10 트러블슈팅

### 이벤트가 전혀 안 옵니다

1. **JWT 토큰 확인**: 위 14.3 명령으로 토큰 발급 됐는지. 빈 문자열이면 응답을 직접 확인:
   ```bash
   curl -i -X POST "http://$HOST:8081/login" \
     -H 'Content-Type: application/json' \
     -d "{\"tenantId\":\"$TID\",\"password\":\"$PW\"}"
   ```
   404면 포트 오타(반드시 `8081`), 401이면 비밀번호 오류.

2. **WebSocket 연결은 됐지만 이벤트가 안 옴**: 본인 DID가 아닌 다른 번호로 전화하고 있을 가능성. 운영자에게 본인 테넌트로 매핑된 DID 번호를 다시 확인.

3. **`call:new`는 안 오고 `channel:state`만 옴**: 다른 테넌트 통화의 시그널이거나, 본인 통화인데 게이트웨이가 아직 통화 정보를 못 받은 매우 이른 시점. 정상 통화라면 곧 `call:new`가 도착합니다.

### WebSocket이 바로 끊김 (`1006`, `unexpected EOF`)

- 토큰 만료(24시간) — `/login` 재발급.
- `?token=`을 URL에 안 넣었거나 잘못 들어감.
- 프록시(nginx 등)가 WebSocket 업그레이드를 차단 — 운영자에게 `Upgrade`/`Connection` 헤더 패스스루 확인.

### TTS 403

linkedId가 본인 테넌트 소유가 아닙니다. `call:new`/`channel:state`에서 받은 `linkedId`를 그대로 사용했는지 확인.

### TTS 404

해당 linkedId의 통화가 이미 종료됐습니다. `call:ended`를 받은 뒤에는 호출 불가.

### 음질 이상 (잡음, 속도)

PCM 포맷 오류. 반드시:
```bash
ffmpeg -y -i input.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le output.pcm
```

---

## 14.11 운영자에게 보낼 체크리스트 템플릿

본인 환경 설정이 안 되어 있다면 운영자에게 다음 메시지를 보내세요:

```
[테넌트 가입 확인 요청]
- 테넌트 ID:        tenant-acme
- 테스트할 DID:     025-555-0100
- 게이트웨이 호스트: gw.example.com  (포트 8080/8081 인바운드 개방 필요)

확인 부탁드립니다:
1) 위 테넌트 ID로 로그인 가능한가요?
2) 위 DID 번호가 제 테넌트로 라우팅되어 있나요?
3) TTS 기능이 활성화된 라이선스인가요?

위 3가지가 모두 OK 라면, 제 휴대폰에서 해당 DID로 전화 시
WebSocket /api/v1/ws/callinfo 에 call:new 이벤트가 도착해야 합니다.
```

위 셋이 충족되어 있고 본 가이드의 14.3~14.5를 그대로 따라하면 이벤트가 도착합니다.
